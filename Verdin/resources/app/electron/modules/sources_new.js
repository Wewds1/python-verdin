const { spawn } = require('child_process');
const path = require('path');
const { app } = require('electron');
const { execSync } = require('child_process');
const db = require('../model/db');
const API_BASE = 'http://localhost:9997/v3/config/paths';
const MEDIA_MTX_RTSP_PORT = process.env.MEDIA_MTX_RTSP_PORT || 8554;
const MAX_CONCURRENT_FFMPEG_PROCESSES = 30;
let currentFfmpegProcesses = 0;
const ffmpegQueue = [];

const activeFfmpegProcesses = new Map();
const ffmpegRetryState = new Map();
const RECONNECT_DELAY_MS = 5000;        // Start with 2 seconds
const MAX_RECONNECT_ATTEMPTS = 10;      // Increased attempts
const EXPONENTIAL_BACKOFF_FACTOR = 1.3; // Gentler backoff
const MAX_RECONNECT_DELAY = 60000;      // Cap at 1 minute

// Stream health monitoring
const streamHealthStats = new Map();

const appRoot = app.isPackaged ? path.join(process.resourcesPath, 'app', 'electron') : path.join(__dirname, '..');
const ffmpegPath = path.join(appRoot, 'ffmpeg', 'ffmpeg.exe');

function updateStreamHealth(pathName, isHealthy) {
    const now = Date.now();
    let stats = streamHealthStats.get(pathName) || {
        lastSeen: now,
        healthyCount: 0,
        unhealthyCount: 0,
        status: 'unknown'
    };
    
    if (isHealthy) {
        stats.healthyCount++;
        stats.status = 'healthy';
    } else {
        stats.unhealthyCount++;
        stats.status = 'unhealthy';
    }
    
    stats.lastSeen = now;
    streamHealthStats.set(pathName, stats);
    
    // Log health status changes
    const total = stats.healthyCount + stats.unhealthyCount;
    const healthPercent = Math.round((stats.healthyCount / total) * 100);
    
    if (total % 10 === 0) { // Log every 10 checks
        console.log(`[${pathName}] Stream health: ${healthPercent}% (${stats.healthyCount}/${total})`);
    }
}

function getStreamHealth(pathName) {
    return streamHealthStats.get(pathName) || null;
}

function cleanupStreamHealth(pathName) {
    streamHealthStats.delete(pathName);
}

function sanitizePathName(name) {
    if (typeof name !== 'string' || name.trim() === '') {
        return '';
    }
    return name.toLowerCase().trim().replace(/\s+/g, '').replace(/[^a-z0-9_.-]/g, '');
}

function getAllSources() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM sources JOIN clients ON sources.client_id = clients.client_id', (err, rows) => {
            if (err) {
                console.error('Database error while fetching sources:', err);
                return reject(new Error(`Failed to fetch sources from database: ${err.message}`));
            }
            return resolve(rows);
        });
    });
}

function encodeRtspUrl(url) {
    const regex = /^(rtsp:\/\/)([^:]+):([^@]+)@(.*)$/;
    const match = url.match(regex);
    if (match) {
        const protocol = match[1];
        const username = encodeURIComponent(match[2]);
        const password = encodeURIComponent(match[3]);
        const rest = match[4];
        return `${protocol}${username}:${password}@${rest}`;
    }
    return url;
}

async function executeAddCamera(name, rtspUrl, currentAttempt = 1) {
    const pathName = sanitizePathName(name);
    if (!pathName) {
        throw new Error('Camera name is invalid or results in an empty path after sanitization.');
    }

    let processedRtspUrl = encodeRtspUrl(rtspUrl);

    const internalRtspPath = `${pathName}_processed`;
    const internalRtspUrl = `rtsp://localhost:${MEDIA_MTX_RTSP_PORT}/${internalRtspPath}`;

    // Detect GPU encoding capabilities
    const encodingType = await detectGPUEncoding();
    const encodingArgs = getEncodingArgs(encodingType);
    
    console.log(`[${pathName}] Using ${encodingType} encoding`);

    const ffmpegArgs = [
        '-loglevel', 'info',     // Changed from 'error' to 'info' for better debugging
        
        // Input reliability improvements with better format handling
        '-rtsp_transport', 'tcp',
        '-timeout', '30000000',  // 30 second timeout in microseconds
        '-fflags', '+genpts+discardcorrupt+igndts', // Generate PTS and handle corrupted frames
        '-avoid_negative_ts', 'make_zero', // Handle negative timestamps
        '-use_wallclock_as_timestamps', '1', // Use wall clock for timestamps
        '-analyzeduration', '10000000',  // Analyze for 10 seconds
        '-probesize', '50000000',        // Probe size for stream detection
        
        '-i', processedRtspUrl,
        
        // Auto-detect and map the best video stream
        '-map', '0:v?',          // Map video if available (optional)
        
        // Video processing - let FFmpeg handle format conversion automatically
        '-vf', 'scale=-1:720:flags=lanczos',  // Scale to 720p height, maintain aspect ratio
        '-r', '30',
        '-fps_mode', 'cfr',      // Constant frame rate mode
        '-force_key_frames', 'expr:gte(t,n_forced*2)', // Force keyframes every 2 seconds
        
        ...encodingArgs,
        
        // Audio handling with fallback - re-enabled with stable settings
        '-map', '0:a?',          // Map audio if available (optional)
        '-c:a', 'aac',           // Use AAC for better compatibility
        '-b:a', '64k',           // Lower bitrate for stability
        '-ac', '2',              // Force stereo output
        '-ar', '48000',          // Standard sample rate
        
        // Output reliability
        '-f', 'rtsp',
        '-rtsp_transport', 'tcp',
        '-muxdelay', '0.1',      // Small mux delay for better sync
        internalRtspUrl
    ];

    console.log(`[${pathName}] Attempt ${currentAttempt}: Spawning FFmpeg with command: ffmpeg ${ffmpegArgs.join(' ')}`);

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
    });
    
    activeFfmpegProcesses.set(pathName, ffmpegProcess);

    ffmpegProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
            console.log(`[${pathName}] FFmpeg stdout: ${output}`);
            updateStreamHealth(pathName, true); // Mark as healthy when producing output
        }
    });

    ffmpegProcess.stderr.on('data', (data) => {
        const stderrOutput = data.toString().trim();
        
        if (stderrOutput) {
            // Check for success indicators
            const successIndicators = [
                'Stream mapping:',
                'Press \\[q\\] to stop',
                'fps=',
                'bitrate=',
                'Opening \'rtsp:',
                'Stream #0'
            ];
            
            const isProgressInfo = successIndicators.some(pattern => 
                new RegExp(pattern, 'i').test(stderrOutput)
            );
            
            // Check for specific error patterns that indicate stream issues
            const criticalErrors = [
                'Connection refused',
                'Network is unreachable',
                'Connection timed out',
                'No route to host',
                'Invalid data found',
                'Protocol not found',
                'Server returned 404',
                'Server returned 401',
                'rtsp://.*: Operation timed out',
                'No such file or directory',
                'Permission denied'
            ];
            
            const isCriticalError = criticalErrors.some(pattern => 
                new RegExp(pattern, 'i').test(stderrOutput)
            );
            
            if (isCriticalError) {
                console.error(`[${pathName}] CRITICAL ERROR detected: ${stderrOutput}`);
                updateStreamHealth(pathName, false);
            } else if (isProgressInfo) {
                console.log(`[${pathName}] FFmpeg progress: ${stderrOutput}`);
                updateStreamHealth(pathName, true);
            } else {
                // Log non-critical messages at debug level
                console.log(`[${pathName}] FFmpeg info: ${stderrOutput}`);
            }
        }
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`[${pathName}] FFmpeg process exited with code ${code}.`);

        activeFfmpegProcesses.delete(pathName);
        currentFfmpegProcesses--;

        if (code !== 0) {
            let retryState = ffmpegRetryState.get(pathName) || { attempts: 0, timer: null };
            retryState.attempts++;

            if (retryState.attempts <= MAX_RECONNECT_ATTEMPTS) {
                const baseDelay = RECONNECT_DELAY_MS * Math.pow(EXPONENTIAL_BACKOFF_FACTOR, retryState.attempts - 1);
                const delay = Math.min(baseDelay, MAX_RECONNECT_DELAY);
                
                console.warn(`[${pathName}] Restarting FFmpeg in ${Math.round(delay / 1000)} seconds (attempt ${retryState.attempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                retryState.timer = setTimeout(() => {
                    console.log(`[${pathName}] Attempting reconnection #${retryState.attempts + 1}`);
                    executeAddCamera(name, rtspUrl, retryState.attempts + 1);
                }, delay);
                ffmpegRetryState.set(pathName, retryState);
            } else {
                console.error(`[${pathName}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up on this stream.`);
                ffmpegRetryState.delete(pathName);
            }
        } else {
            console.log(`[${pathName}] FFmpeg process closed successfully.`);
            ffmpegRetryState.delete(pathName);
        }
        processNextFfmpegTask();
    });

    ffmpegProcess.on('error', (err) => {
        console.error(`[${pathName}] Failed to start FFmpeg process: ${err.message}`);
        activeFfmpegProcesses.delete(pathName);
        currentFfmpegProcesses--;

        let retryState = ffmpegRetryState.get(pathName) || { attempts: 0, timer: null };
        retryState.attempts++;

        if (retryState.attempts <= MAX_RECONNECT_ATTEMPTS) {
            const baseDelay = RECONNECT_DELAY_MS * Math.pow(EXPONENTIAL_BACKOFF_FACTOR, retryState.attempts - 1);
            const delay = Math.min(baseDelay, MAX_RECONNECT_DELAY);
            
            console.warn(`[${pathName}] Retrying FFmpeg process start in ${Math.round(delay / 1000)} seconds (attempt ${retryState.attempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            retryState.timer = setTimeout(() => {
                console.log(`[${pathName}] Attempting process restart #${retryState.attempts + 1}`);
                executeAddCamera(name, rtspUrl, retryState.attempts + 1);
            }, delay);
            ffmpegRetryState.set(pathName, retryState);
        } else {
            console.error(`[${pathName}] Max retry attempts (${MAX_RECONNECT_ATTEMPTS}) reached for process start failure. Giving up.`);
            ffmpegRetryState.delete(pathName);
        }
        processNextFfmpegTask();
    });

    currentFfmpegProcesses++;

    const url = `${API_BASE}/add/${encodeURIComponent(pathName)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source: internalRtspUrl,
        })
    });
    const text = await res.text();

    if (!res.ok) {
        console.error(`[${pathName}] Control API error body:`, text);
        
        ffmpegProcess.kill();
        activeFfmpegProcesses.delete(pathName);
        currentFfmpegProcesses--;
        ffmpegRetryState.delete(pathName);
        processNextFfmpegTask();
        throw new Error(`Add failed: ${res.status} ${res.statusText} - MediaMTX response: ${text}`);
    }
    if (!text) {
        console.log(`[${pathName}] Path "${pathName}" added to MediaMTX, sourcing from FFmpeg at "${internalRtspUrl}".`);
        return { success: true, pathName: pathName, message: `Path "${pathName}" added successfully.` };
    }
    try {
        const responseData = JSON.parse(text);
        console.log(`[${pathName}] Path "${pathName}" added/updated in MediaMTX. Response: ${JSON.stringify(responseData)}`);
        return responseData;
    } catch (err) {
        console.error(`[${pathName}] Invalid JSON response from MediaMTX:`, text, err);
        ffmpegProcess.kill();
        activeFfmpegProcesses.delete(pathName);
        currentFfmpegProcesses--;
        ffmpegRetryState.delete(pathName);
        processNextFfmpegTask();
        throw new Error('Invalid JSON in Control API response');
    }
}

async function removeCamera(name) {
    const pathName = sanitizePathName(name);
    if (!pathName) {
        throw new Error('Camera name is invalid or results in an empty path after sanitization for removal.');
    }

    const retryState = ffmpegRetryState.get(pathName);
    if (retryState && retryState.timer) {
        clearTimeout(retryState.timer);
        ffmpegRetryState.delete(pathName);
        console.log(`[${pathName}] Cleared pending FFmpeg retry timer.`);
    }

    const ffmpegProcess = activeFfmpegProcesses.get(pathName);
    if (ffmpegProcess) {
        console.log(`Killing FFmpeg process for ${pathName} (PID: ${ffmpegProcess.pid}) before removing from MediaMTX.`);
        ffmpegProcess.kill();
        activeFfmpegProcesses.delete(pathName);
        currentFfmpegProcesses--;
        processNextFfmpegTask();
    } else {
        console.warn(`No active FFmpeg process found for ${pathName}. It might have already exited or was not started by this app.`);
    }

    const url = `${API_BASE}/delete/${encodeURIComponent(pathName)}`;
    const res = await fetch(url, { method: 'DELETE' });
    const text = await res.text();
    if (!res.ok) {
        console.error('Control API error body:', text);
        throw new Error(`Remove failed: ${res.status} ${res.statusText}`);
    }
    console.log(`Path "${pathName}" removed from MediaMTX.`);
    return { success: true, pathName: pathName, message: `Path "${pathName}" removed successfully.` };
}







// NEW PROCESS

async function addCamera(name, rtspUrl) {
    // return new Promise((resolve, reject) => {
    //     ffmpegQueue.push({ name, rtspUrl, originalResolve: resolve, originalReject: reject });
    //     processNextFfmpegTask();
    // });


    

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source: rtspUrl,
            runOnReady: "./ffmpeg/bin/ffmpeg.exe -rtsp_transport tcp -i rtsp://localhost:$RTSP_PORT/$RTSP_PATH -c:v libx264 -preset ultrafast -pix_fmt yuv420p -an -f rtsp -rtsp_transport tcp rtsp://localhost:$RTSP_PORT/${RTSP_PATH}_h264",
            runOnReadyRestart: true
        })
    });
}

function processNextFfmpegTask() {
    if (currentFfmpegProcesses < MAX_CONCURRENT_FFMPEG_PROCESSES && ffmpegQueue.length > 0) {
        const { name, rtspUrl, originalResolve, originalReject } = ffmpegQueue.shift();
        // console.log(`Starting FFmpeg process for "${name}". Active processes: ${currentFfmpegProcesses}/${MAX_CONCURRENT_FFMPEG_PROCESSES}`);

        executeAddCamera(name, rtspUrl)
            .then(result => {
                if (!ffmpegRetryState.has(sanitizePathName(name)) || ffmpegRetryState.get(sanitizePathName(name)).attempts === 0) {
                    originalResolve(result);
                }
            })
            .catch(error => {
                if (!ffmpegRetryState.has(sanitizePathName(name))) {
                     originalReject(error);
                }
            });
    } else {
        console.log(`FFmpeg queue idle. Active: ${currentFfmpegProcesses}/${MAX_CONCURRENT_FFMPEG_PROCESSES}, Queued: ${ffmpegQueue.length}`);
    }
}

// GPU detection and encoding selection
let gpuEncodingAvailable = null; // Cache the result
let gpuDetectionPromise = null; // Promise to prevent concurrent detection

async function detectGPUEncoding() {
    if (gpuEncodingAvailable !== null) {
        return gpuEncodingAvailable;
    }

    // If detection is already in progress, wait for it
    if (gpuDetectionPromise !== null) {
        console.log('� GPU detection already in progress, waiting for result...');
        return await gpuDetectionPromise;
    }

    console.log('�🔍 Detecting GPU encoding capabilities...');
    
    // Create the detection promise to prevent concurrent calls
    gpuDetectionPromise = performGPUDetection();
    
    try {
        const result = await gpuDetectionPromise;
        gpuEncodingAvailable = result;
        return result;
    } finally {
        gpuDetectionPromise = null;
    }
}

async function performGPUDetection() {
    try {
        // Test NVIDIA encoding
        const testResult = await testNVIDIAEncoding();
        if (testResult) {
            console.log('✅ NVIDIA GPU encoding (h264_nvenc) is available');
            return 'nvidia';
        }
    } catch (error) {
        console.log('❌ NVIDIA GPU encoding not available:', error.message);
    }

    try {
        // Test Intel Quick Sync
        const testResult = await testIntelQSVEncoding();
        if (testResult) {
            console.log('✅ Intel Quick Sync encoding (h264_qsv) is available');
            return 'intel';
        }
    } catch (error) {
        console.log('❌ Intel Quick Sync encoding not available:', error.message);
    }

    try {
        // Test AMD encoding
        const testResult = await testAMDEncoding();
        if (testResult) {
            console.log('✅ AMD GPU encoding (h264_amf) is available');
            return 'amd';
        }
    } catch (error) {
        console.log('❌ AMD GPU encoding not available:', error.message);
    }

    console.log('ℹ️ No hardware encoding available, using software encoding (libx264)');
    return 'software';
}

function testNVIDIAEncoding() {
    return new Promise((resolve) => {
        const testProcess = spawn(ffmpegPath, [
            '-f', 'lavfi',
            '-i', 'testsrc2=duration=1:size=320x240:rate=30',
            '-c:v', 'h264_nvenc',
            '-preset', 'p1',
            '-t', '1',
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        let hasError = false;
        testProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Cannot load nvcuda.dll') || 
                output.includes('No NVENC capable devices found') ||
                output.includes('Unknown encoder') ||
                output.includes('Error while opening encoder')) {
                hasError = true;
            }
        });

        testProcess.on('close', (code) => {
            resolve(!hasError && code === 0);
        });

        testProcess.on('error', () => {
            resolve(false);
        });

        // Timeout after 5 seconds
        setTimeout(() => {
            testProcess.kill();
            resolve(false);
        }, 5000);
    });
}

function testIntelQSVEncoding() {
    return new Promise((resolve) => {
        const testProcess = spawn(ffmpegPath, [
            '-f', 'lavfi',
            '-i', 'testsrc2=duration=1:size=320x240:rate=30',
            '-c:v', 'h264_qsv',
            '-preset', 'fast',
            '-t', '1',
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        let hasError = false;
        testProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Unknown encoder') ||
                output.includes('Error while opening encoder') ||
                output.includes('No QSV device found')) {
                hasError = true;
            }
        });

        testProcess.on('close', (code) => {
            resolve(!hasError && code === 0);
        });

        testProcess.on('error', () => {
            resolve(false);
        });

        setTimeout(() => {
            testProcess.kill();
            resolve(false);
        }, 5000);
    });
}

function testAMDEncoding() {
    return new Promise((resolve) => {
        const testProcess = spawn(ffmpegPath, [
            '-f', 'lavfi',
            '-i', 'testsrc2=duration=1:size=320x240:rate=30',
            '-c:v', 'h264_amf',
            '-quality', 'balanced',
            '-t', '1',
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        let hasError = false;
        testProcess.stderr.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Unknown encoder') ||
                output.includes('Error while opening encoder') ||
                output.includes('AMF encoder not found')) {
                hasError = true;
            }
        });

        testProcess.on('close', (code) => {
            resolve(!hasError && code === 0);
        });

        testProcess.on('error', () => {
            resolve(false);
        });

        setTimeout(() => {
            testProcess.kill();
            resolve(false);
        }, 5000);
    });
}

function getEncodingArgs(encodingType) {
    switch (encodingType) {
        case 'nvidia':
            return [
                '-c:v', 'h264_nvenc',
                '-preset', 'p1',          // Fastest preset for low latency
                '-tune', 'll',            // Low latency tuning
                '-profile:v', 'main',     // More flexible than baseline
                '-level', '4.0',          // Higher level for better compatibility
                '-pix_fmt', 'yuv420p',    // Force compatible pixel format
                '-b:v', '800k',           // Increased bitrate for stability
                '-maxrate', '1200k',      // Higher max bitrate
                '-bufsize', '2400k',      // Buffer size = 2x maxrate
                '-g', '60',               // GOP size (2 seconds at 30fps)
                '-keyint_min', '30',      // Min keyframe interval
                '-spatial_aq', '1',       // Spatial adaptive quantization
                '-temporal_aq', '1',      // Temporal adaptive quantization
                '-rc', 'cbr',             // Constant bitrate for stability
                '-rc-lookahead', '20',    // Lookahead frames for better quality
                '-surfaces', '8',         // More encoding surfaces
                '-bf', '0'                // No B-frames for lower latency
            ];
        case 'intel':
            return [
                '-c:v', 'h264_qsv',
                '-preset', 'fast',
                '-profile:v', 'main',
                '-level', '4.0',
                '-pix_fmt', 'yuv420p',    // Force compatible pixel format
                '-b:v', '800k',
                '-maxrate', '1200k',
                '-bufsize', '2400k',
                '-g', '60',
                '-keyint_min', '30',
                '-look_ahead', '1',       // Enable lookahead
                '-look_ahead_depth', '15', // Lookahead depth
                '-mbbrc', '1',            // Macroblock level rate control
                '-extbrc', '1',           // Extended rate control
                '-adaptive_i', '1',       // Adaptive I-frame placement
                '-adaptive_b', '1',       // Adaptive B-frame placement
                '-bf', '0'                // No B-frames for lower latency
            ];
        case 'amd':
            return [
                '-c:v', 'h264_amf',
                '-quality', 'balanced',
                '-profile:v', 'main',
                '-level', '4.0',
                '-pix_fmt', 'yuv420p',    // Force compatible pixel format
                '-b:v', '800k',
                '-maxrate', '1200k',
                '-bufsize', '2400k',
                '-g', '60',
                '-keyint_min', '30',
                '-rc', 'cbr',             // Constant bitrate
                '-preanalysis', '1',      // Enable preanalysis
                '-vbaq', '1',             // Variance based adaptive quantization
                '-enforce_hrd', '1',      // Enforce HRD compliance
                '-filler_data', '1',      // Add filler data for CBR
                '-bf', '0'                // No B-frames for lower latency
            ];
        case 'software':
        default:
            return [
                '-c:v', 'libx264',
                '-preset', 'veryfast',    // Faster than 'fast' but still good quality
                '-profile:v', 'main',     // More flexible than baseline
                '-level', '4.0',
                '-crf', '26',             // Slightly better quality
                '-maxrate', '1200k',
                '-bufsize', '2400k',
                '-g', '60',
                '-keyint_min', '30',
                '-x264-params', 'nal-hrd=cbr:force-cfr=1', // CBR and constant frame rate
                '-pix_fmt', 'yuv420p',    // Ensure compatible pixel format
                '-movflags', '+faststart', // Fast start for better streaming
                '-bf', '0'                // No B-frames for lower latency
            ];
    }
}

function addSource(rtsp_link, name, client){
    return new Promise((resolve) => {
        db.all('SELECT * FROM sources WHERE rtsp_link=?', rtsp_link, (err, rows) => {
            if (err) {
                return resolve({ success: false, message: 'Error fetching sources' });
            }
        
            if (rows.length > 0) {
                return resolve({ success: false, message: 'RTSP link already exist' });
            }
    
            db.all('SELECT * FROM sources WHERE name=? AND client_id=?', [name, client], (err, rows) => {
                if (err) {
                    return resolve({ success: false, message: 'Error fetching sources' });
                }
            
                if (rows.length > 0) {
                    return resolve({ success: false, message: 'Name already exist' });
                }
        
                db.run('INSERT INTO sources(rtsp_link, name, client_id) VALUES (?, ?, ?)', [rtsp_link, name, client], function (err) {
                    if (err) {
                        console.error('Error adding new source:', err.message);
                        return resolve({ success: false, message: 'Error adding new source' });
                    }
                    
                    const lastInsertedId = this.lastID;

                    db.run('INSERT INTO settings(source_id) VALUES (?)', [lastInsertedId], function (err) {
                        if (err) {
                            console.error('Error adding settings for the new source:', err.message);
                            return resolve({ success: false, message: 'Error adding new source' });
                        }
                
                        // Return the new source data including the ID
                        return resolve({ 
                            success: true, 
                            message: 'Successfully added new source',
                            source: {
                                source_id: lastInsertedId,
                                rtsp_link: rtsp_link,
                                name: name,
                                client_id: client
                            }
                        });
                    });
                });
            });
        });
    })
}


function updateSource(data){
    return new Promise((resolve) => {
        db.all('UPDATE sources SET rtsp_link=?, name=?, map_coordinates=?, client_id=? WHERE source_id=?', [data.rtsp_link, data.name, data.map_coordinates, data.client, data.source_id], (err, rows) => {
            if (err) {
                return resolve({ status: 'failed', message: 'Error updating source' });
            }

            db.all('UPDATE settings SET video_width=?, video_height=?, bitrate=?, max_bitrate=?, buffer_size=?, fps=?, segment_duration=?, total_segment_list=? WHERE source_id=?', [data.video_width, data.video_height, data.bitrate, data.max_bitrate, data.buffer_size, data.framerate, data.segment_duration, data.total_segment_list, data.source_id], (err, rows) => {
                if (err) {
                    return resolve({ status: 'failed', message: 'Error updating source' });
                }

                return resolve(data);
            });
        });

        
    })
}

async function deleteSource(source_id){
    try {
        console.log(`🗑️ deleteSource called with source_id: ${source_id}`);
        
        const result = await new Promise((resolve, reject) => {
            console.log(`🔍 Executing DELETE FROM sources WHERE source_id = ${source_id}`);
            
            db.run('DELETE FROM sources WHERE source_id = ?', [source_id], function (err) {
                if (err) {
                    console.error(`❌ Database error during deletion:`, err);
                    return reject(err);
                }
                
                console.log(`📊 Delete operation completed. Changes: ${this.changes}, Last ID: ${this.lastID}`);
                resolve({ status: 'success', message: 'Source has been deleted', changes: this.changes });
            });
        });
        
        console.log(`✅ deleteSource completed successfully:`, result);
        return result;
    } catch (error) {
        console.error('💥 Error in deleteSource:', error);
        return { status: 'failed', message: 'Error deleting source' };
    }
}


function getClients() {
    return new Promise((resolve) => {
        db.all('SELECT * FROM clients', (err, rows) => {
            if (err) {
                return resolve({ message: 'Error fetching clients' });
            }
        
            if (rows.length === 0) {
                return resolve({ message: 'No clients found' });
            }

            return resolve(rows);
        });
    })
}


function getAllSources() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM sources JOIN clients ON sources.client_id = clients.client_id', (err, rows) => {
            if (err) {
                console.error('Database error while fetching sources:', err);
                return reject(new Error(`Failed to fetch sources from database: ${err.message}`));
            }
            return resolve(rows);
        });
    });
}

function updateSource(sourceId, data) {
    return new Promise((resolve, reject) => {
        const { name, rtsp_link, client_id } = data;
        
        // First, check if the source exists
        db.get('SELECT * FROM sources WHERE source_id = ?', [sourceId], (err, row) => {
            if (err) {
                console.error('Database error while checking source:', err);
                return reject(new Error(`Database error: ${err.message}`));
            }
            
            if (!row) {
                return reject(new Error('Source not found'));
            }
            
            // Check if the client exists
            db.get('SELECT * FROM clients WHERE client_id = ?', [client_id], (err, clientRow) => {
                if (err) {
                    console.error('Database error while checking client:', err);
                    return reject(new Error(`Database error: ${err.message}`));
                }
                
                if (!clientRow) {
                    return reject(new Error('Client not found'));
                }
                
                // Update the source
                const query = 'UPDATE sources SET name = ?, rtsp_link = ?, client_id = ? WHERE source_id = ?';
                db.run(query, [name, rtsp_link, client_id, sourceId], function(err) {
                    if (err) {
                        console.error('Database error while updating source:', err);
                        return reject(new Error(`Failed to update source: ${err.message}`));
                    }
                    
                    if (this.changes === 0) {
                        return reject(new Error('No source was updated'));
                    }
                    
                    console.log(`✅ Updated source ${sourceId} successfully`);
                    resolve({ 
                        status: 'success', 
                        message: 'Source updated successfully',
                        sourceId: sourceId
                    });
                });
            });
        });
    });
}


module.exports = { addCamera, removeCamera, getAllSources, addSource, getClients, deleteSource, updateSource };
