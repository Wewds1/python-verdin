
const db = require('../model/db');
const API_BASE = 'http://localhost:9997/v3/config/paths';
const PythonMotionIntegration = require('./python-motion.js');
let currentFfmpegProcesses = 0;
let motionSystem = null;
const activeFfmpegProcesses = new Map();
const ffmpegRetryState = new Map();

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
    const regex = /^(rtsp:\/\/)([^:]+):(.+)@([^@]+)$/;
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


function initializeMotionSystem() {
    if (!motionSystem) {
        motionSystem = new PythonMotionIntegration();
        console.log('Motion detection system initialized');
    }
    return motionSystem;
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







// NEW PROCESS (GOOGLE CHROME)

async function addCamera(name, clientName, rtspUrl) {
    const pathName = sanitizePathName(name);
    const client_name = sanitizePathName(clientName);
    const url = `${API_BASE}/add/${client_name}/${encodeURIComponent(pathName)}`;
    const rtspUrlEncoded = encodeRtspUrl(rtspUrl);

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name,
            source: rtspUrlEncoded
        })
    });

    const text = await res.text();

    if (!res.ok) {
        console.error(`[${name}] Control API error body:`, text);
        throw new Error(`Add failed: ${res.status} ${res.statusText} - MediaMTX response: ${text}`);
    }


    if (!text) {
        console.log(`[${name}] Path "${name}" added to MediaMTX, sourcing from FFmpeg at "${internalRtspUrl}".`);
        return { success: true, pathName: name, message: `Path "${name}" added successfully.` };
    }
}





async function addSource(rtsp_link, name, client, location = '', username = '', password = '') {
  try {
    /* 1.  Duplicate checks */
    const byUrl  = await db.get('SELECT * FROM sources WHERE rtsp_link=?', rtsp_link);
    if (byUrl) return { success: false, message: 'RTSP link already exist1' };

    const byName = await db.get('SELECT * FROM sources WHERE name=? AND client_id=?', [name, client]);
    if (byName) return { success: false, message: 'Name already exist' };

    /* 2.  Insert source */
    const { lastID: sourceId } = await db.run(
      'INSERT INTO sources(rtsp_link, name, client_id) VALUES (?,?,?)',
      [rtsp_link, name, client]
    );

    /* 3.  Insert default settings row */
    await db.run('INSERT INTO settings(source_id) VALUES (?)', [sourceId]);

    /* 4.  Optional: push to Python motion stack (fire-and-forget) */
    try {
      if (rtsp_link.startsWith('rtsp://') ||
          rtsp_link.startsWith('http://') ||
          rtsp_link.startsWith('https://')) {

        const motion = initializeMotionSystem();   
        motion.addCameraToPython({
          name: name,
          url:  rtsp_link,
          location: location || 'Verdin Camera'
        }).catch(e =>
          console.warn('Motion system unreachable - camera still added to Verdin:', e.message)
        );
      }
    } catch (e) {
      console.warn('Motion system init failed - camera still added to Verdin:', e.message);
    }

    /* 5.  Success payload */
    return {
      success: true,
      message: 'Successfully added new source',
      source: {
        source_id: sourceId,
        rtsp_link,
        name,
        client_id: client
      }
    };
  } catch (err) {
    console.error('addSource error:', err);
    return { success: false, message: 'Error adding new source' };
  }
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


module.exports = { addCamera, removeCamera, getAllSources, addSource, getClients, deleteSource, updateSource,     
    getMotionSystem: () => initializeMotionSystem(),
    startMotionDetection: async () => {
        const motion = initializeMotionSystem();
        return await motion.startPythonSystem();
    },
    stopMotionDetection: () => {
        if (motionSystem) {
            motionSystem.stopPythonSystem();
        }
    },
    getMotionStatus: async () => {
        if (motionSystem) {
            return await motionSystem.getSystemStatus();
        }
        return { running: false };
    }};
