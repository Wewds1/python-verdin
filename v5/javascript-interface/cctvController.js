import { io } from 'socket.io-client';
import fetch from 'node-fetch';

class CCTVController {
    constructor(controlApiUrl = 'http://localhost:5001', webhookServerUrl = 'http://139.177.195.237:3000') {
        this.controlApiUrl = controlApiUrl;
        this.webhookServerUrl = webhookServerUrl;
        this.socket = null;
        this.eventHandlers = {};
        
        this.init();
    }
    
    async init() {
        try {
            // Connect to webhook server for real-time notifications
            this.socket = io(this.webhookServerUrl, {
                transports: ['websocket', 'polling'],
                timeout: 20000,
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });
            
            this.socket.on('connect', () => {
                console.log('✓ Connected to CCTV webhook server');
                this.emit('connected');
            });
            
            this.socket.on('disconnect', () => {
                console.log('✗ Disconnected from webhook server');
                this.emit('disconnected');
            });
            
            this.socket.on('motionAlert', (data) => {
                console.log('🚨 Motion detected:', data);
                this.emit('motionAlert', data);
            });
            
            this.socket.on('simpleNotification', (data) => {
                console.log('📢 Notification:', data);
                this.emit('simpleNotification', data);
            });
            
            this.socket.on('welcome', (data) => {
                console.log('👋 Welcome:', data.message);
            });
            
            this.socket.on('connect_error', (error) => {
                console.log('❌ Connection error:', error.message);
            });
            
        } catch (error) {
            console.error('Failed to initialize CCTV controller:', error);
        }
    }
    
    // Event system
    on(event, handler) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(handler);
    }
    
    emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => handler(data));
        }
    }
    
    // API Methods
    async getStatus() {
        try {
            const response = await fetch(`${this.controlApiUrl}/status`);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get status:', error.message);
            throw error;
        }
    }
    
    async setYoloFiltering(enabled) {
        try {
            const response = await fetch(`${this.controlApiUrl}/settings/yolo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const result = await response.json();
            console.log(`✓ YOLO filtering ${enabled ? 'enabled' : 'disabled'}`);
            return result;
        } catch (error) {
            console.error('Failed to set YOLO filtering:', error.message);
            throw error;
        }
    }
    
    async setViewResolution(width, height) {
        try {
            const response = await fetch(`${this.controlApiUrl}/settings/view`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ width, height })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const result = await response.json();
            console.log(`✓ View resolution set to ${width}x${height}`);
            return result;
        } catch (error) {
            console.error('Failed to set view resolution:', error.message);
            throw error;
        }
    }
    
    async setNotifications(enabled) {
        try {
            const response = await fetch(`${this.controlApiUrl}/settings/notifications`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const result = await response.json();
            console.log(`✓ Notifications ${enabled ? 'enabled' : 'disabled'}`);
            return result;
        } catch (error) {
            console.error('Failed to set notifications:', error.message);
            throw error;
        }
    }
    
    async getCameras() {
        try {
            const response = await fetch(`${this.controlApiUrl}/cameras`);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get cameras:', error.message);
            throw error;
        }
    }
    
    async getCameraROIs(cameraName) {
        try {
            const response = await fetch(`${this.controlApiUrl}/cameras/${encodeURIComponent(cameraName)}/rois`);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get camera ROIs:', error.message);
            throw error;
        }
    }
    
    async addROI(cameraName, roiName, points) {
        try {
            const response = await fetch(`${this.controlApiUrl}/cameras/${encodeURIComponent(cameraName)}/rois`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: roiName, points })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const result = await response.json();
            console.log(`✓ ROI '${roiName}' added to camera '${cameraName}'`);
            return result;
        } catch (error) {
            console.error('Failed to add ROI:', error.message);
            throw error;
        }
    }
    
    async updateROI(cameraName, roiId, roiName, points) {
        try {
            const response = await fetch(`${this.controlApiUrl}/cameras/${encodeURIComponent(cameraName)}/rois/${roiId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: roiName, points })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const result = await response.json();
            console.log(`✓ ROI ${roiId} updated`);
            return result;
        } catch (error) {
            console.error('Failed to update ROI:', error.message);
            throw error;
        }
    }
    
    async deleteROI(cameraName, roiId) {
        try {
            const response = await fetch(`${this.controlApiUrl}/cameras/${encodeURIComponent(cameraName)}/rois/${roiId}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const result = await response.json();
            console.log(`✓ ROI ${roiId} deleted`);
            return result;
        } catch (error) {
            console.error('Failed to delete ROI:', error.message);
            throw error;
        }
    }
    
    // Utility methods
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            console.log('✓ Disconnected from webhook server');
        }
    }
    
    async testConnection() {
        try {
            console.log('🔍 Testing connections...');
            
            // Test control API
            const status = await this.getStatus();
            console.log('✓ Control API connected');
            
            // Test WebSocket
            return new Promise((resolve) => {
                if (this.socket && this.socket.connected) {
                    console.log('✓ WebSocket connected');
                    resolve({ api: true, websocket: true, status });
                } else {
                    // Wait for connection
                    const timeout = setTimeout(() => {
                        console.log('⚠ WebSocket connection timeout');
                        resolve({ api: true, websocket: false, status });
                    }, 5000);
                    
                    this.socket.once('connect', () => {
                        clearTimeout(timeout);
                        console.log('✓ WebSocket connected');
                        resolve({ api: true, websocket: true, status });
                    });
                }
            });
        } catch (error) {
            console.error('✗ Connection test failed:', error.message);
            return { api: false, websocket: false, error: error.message };
        }
    }
}

export default CCTVController;