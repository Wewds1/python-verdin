const { spawn } = require('child_process');
const path = require('path');

class CCTVController {
    constructor(pythonScriptPath = '../cctv_cli.py') {
        this.pythonScriptPath = pythonScriptPath;
    }

    // ========== CAMERA OPERATIONS ==========
    async startCamera(cameraName, rtspInput, options = {}) {
        const args = ['start-camera', '--camera', cameraName, '--rtsp-input', rtspInput];
        
        if (options.rtspOutput) args.push('--rtsp-output', options.rtspOutput);
        if (options.noMotion) args.push('--no-motion');
        if (options.noYolo) args.push('--no-yolo');
        if (options.noStreaming) args.push('--no-streaming');
        if (options.daemon) args.push('--daemon');
        
        return this.executeCommand(args);
    }

    async stopCamera(cameraName) {
        return this.executeCommand(['stop-camera', '--camera', cameraName]);
    }

    async stopAllCameras() {
        return this.executeCommand(['stop-all']);
    }

    async getCameraStatus(cameraName = null) {
        const args = ['camera-status'];
        if (cameraName) args.push('--camera', cameraName);
        return this.executeCommand(args);
    }

    async listCameras() {
        return this.executeCommand(['list-cameras']);
    }

    async addCamera(cameraName, rtspInput, rtspOutput = null) {
        const args = ['add-camera', '--camera', cameraName, '--rtsp-input', rtspInput];
        if (rtspOutput) args.push('--rtsp-output', rtspOutput);
        return this.executeCommand(args);
    }

    // ========== ROI OPERATIONS ==========
    async addROI(cameraName, roiName, points) {
        return this.executeCommand([
            'add-roi',
            '--camera', cameraName,
            '--roi-name', roiName,
            '--points', JSON.stringify(points)
        ]);
    }

    async updateROI(roiId, roiName, points) {
        return this.executeCommand([
            'update-roi',
            '--roi-id', roiId.toString(),
            '--roi-name', roiName,
            '--points', JSON.stringify(points)
        ]);
    }

    async deleteROI(roiId) {
        return this.executeCommand(['delete-roi', '--roi-id', roiId.toString()]);
    }

    async listROIs(cameraName) {
        return this.executeCommand(['list-rois', '--camera', cameraName]);
    }

    // ========== FEATURE TOGGLES ==========
    async enableMotionDetection(cameraName) {
        return this.executeCommand(['motion-on', '--camera', cameraName]);
    }

    async disableMotionDetection(cameraName) {
        return this.executeCommand(['motion-off', '--camera', cameraName]);
    }

    async enableYoloDetection(cameraName) {
        return this.executeCommand(['yolo-on', '--camera', cameraName]);
    }

    async disableYoloDetection(cameraName) {
        return this.executeCommand(['yolo-off', '--camera', cameraName]);
    }

    async enableStreaming(cameraName) {
        return this.executeCommand(['streaming-on', '--camera', cameraName]);
    }

    async disableStreaming(cameraName) {
        return this.executeCommand(['streaming-off', '--camera', cameraName]);
    }

    async enableWhatsApp(cameraName) {
        return this.executeCommand(['whatsapp-on', '--camera', cameraName]);
    }

    async disableWhatsApp(cameraName) {
        return this.executeCommand(['whatsapp-off', '--camera', cameraName]);
    }

    // ========== UTILITY ==========
    async initializeDatabase() {
        return this.executeCommand(['init-db']);
    }

    // Execute command helper
    executeCommand(args) {
        return new Promise((resolve, reject) => {
            const python = spawn('python', [this.pythonScriptPath, ...args]);
            
            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout.trim());
                    resolve(result);
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${stdout}`));
                }
            });

            python.on('error', (error) => {
                reject(error);
            });
        });
    }
}

module.exports = CCTVController;