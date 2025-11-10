const { spawn } = require('child_process');
const path = require('path');

class PythonMotionIntegration {
    constructor() {
        this.pythonAPI = 'http://localhost:5001';
        this.pythonProcess = null;
        this.isRunning = false;
        
        // Path to your v5 Python system
        this.pythonSystemPath = path.resolve('..', '..', '..', '..', 'v5');
        console.log('Python system path:', this.pythonSystemPath);
    }

    // Check if Python API is responding
    async checkPythonSystem() {
        try {
            const response = await fetch(`${this.pythonAPI}/health`, { 
                method: 'GET',
                timeout: 3000 
            });
            return response.ok;
        } catch (error) {
            console.log('Python system not responding:', error.message);
            return false;
        }
    }

    // Start Python motion detection system
    async startPythonSystem() {
        console.log('Starting Python motion detection system...');
        
        // Check if already running
        if (await this.checkPythonSystem()) {
            console.log('Python motion system already running');
            this.isRunning = true;
            return true;
        }

        try {
            // Start Python system
            console.log('Starting Python from:', this.pythonSystemPath);
            
            this.pythonProcess = spawn('python', ['start_production.py'], {
                cwd: this.pythonSystemPath,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true
            });

            // Handle Python output
            this.pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log('Python System:', output);
            });

            this.pythonProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.error('Python Error:', error);
            });

            this.pythonProcess.on('close', (code) => {
                console.log(`Python system exited with code: ${code}`);
                this.isRunning = false;
            });

            // Wait for system to start
            console.log('Waiting for Python system to start...');
            await this.waitForSystem(15000); // Wait up to 15 seconds

            const isRunning = await this.checkPythonSystem();
            if (isRunning) {
                console.log('Python motion system started successfully');
                this.isRunning = true;
                return true;
            } else {
                console.log('Python system failed to start');
                return false;
            }

        } catch (error) {
            console.error(' Error starting Python system:', error);
            return false;
        }
    }

    // Wait for Python system to be ready
    async waitForSystem(maxWaitTime) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
            if (await this.checkPythonSystem()) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return false;
    }

    // Stop Python system
    stopPythonSystem() {
        if (this.pythonProcess) {
            console.log('Stopping Python motion system...');
            this.pythonProcess.kill('SIGTERM');
            this.isRunning = false;
            this.pythonProcess = null;
        }
    }

    // Add camera to Python motion detection
    async addCameraToPython(cameraData) {
        if (!await this.checkPythonSystem()) {
            console.log('Python system not running, cannot add camera');
            return null;
        }

        try {
            console.log(`📹 Adding camera to Python: ${cameraData.name}`);
            
            const response = await fetch(`${this.pythonAPI}/api/cameras`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: cameraData.name || 'Verdin Camera',
                    url: cameraData.url,
                    location: cameraData.location || 'Verdin App',
                    type: 'rtsp',
                    enabled: true,
                    motion_detection: {
                        enabled: true,
                        threshold: 75,
                        min_area: 3000
                    },
                    recording: {
                        enabled: false,
                        motion_only: true
                    }
                })
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`Camera ${cameraData.name} added to motion detection`);
                return result;
            } else {
                const errorText = await response.text();
                console.log(` Failed to add camera: ${response.status} - ${errorText}`);
                return null;
            }

        } catch (error) {
            console.error('Error adding camera to Python:', error);
            return null;
        }
    }

    // Get recent motion alerts
    async getRecentAlerts() {
        if (!await this.checkPythonSystem()) {
            return [];
        }

        try {
            const response = await fetch(`${this.pythonAPI}/api/alerts/recent`);
            if (response.ok) {
                return await response.json();
            }
            return [];
        } catch (error) {
            console.log('Could not fetch alerts:', error.message);
            return [];
        }
    }

    // Get system status
    async getSystemStatus() {
        const isRunning = await this.checkPythonSystem();
        return {
            running: isRunning,
            api_url: this.pythonAPI,
            process_running: this.isRunning
        };
    }
}

module.exports = PythonMotionIntegration;