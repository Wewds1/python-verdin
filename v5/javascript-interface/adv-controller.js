import { io } from 'socket.io-client';
import fetch from 'node-fetch';
import { EventEmitter } from 'events';

class AdvancedCCTVController extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            controlApiUrl: options.controlApiUrl || 'http://localhost:5001',
            webhookServerUrl: options.webhookServerUrl || 'http://139.177.195.237:3000',
            reconnectDelay: options.reconnectDelay || 5000,
            healthCheckInterval: options.healthCheckInterval || 30000,
            ...options
        };
        
        this.socket = null;
        this.isConnected = false;
        this.lastStatus = null;
        this.statistics = {
            motionAlerts: 0,
            apiCalls: 0,
            errors: 0,
            startTime: Date.now()
        };
        
        this.init();
    }
    
    async init() {
        console.log('Initializing Advanced CCTV Controller...');
        
        try {
            await this.connectWebSocket();
            await this.startHealthMonitoring();
            console.log('Advanced CCTV Controller ready');
            this.emit('ready');
        } catch (error) {
            console.error('Initialization failed:', error);
            this.emit('error', error);
        }
    }
    
    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                this.socket = io(this.config.webhookServerUrl, {
                    transports: ['websocket', 'polling'],
                    timeout: 20000,
                    reconnection: true,
                    reconnectionAttempts: 10,
                    reconnectionDelay: this.config.reconnectDelay
                });
                
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    console.log('WebSocket connected to webhook server');
                    this.emit('websocket_connected');
                    resolve();
                });
                
                this.socket.on('disconnect', (reason) => {
                    this.isConnected = false;
                    console.log(`WebSocket disconnected: ${reason}`);
                    this.emit('websocket_disconnected', reason);
                });
                
                this.socket.on('connect_error', (error) => {
                    console.error('WebSocket connection error:', error.message);
                    this.statistics.errors++;
                    this.emit('websocket_error', error);
                    if (!this.isConnected) reject(error);
                });
                
                this.socket.on('motionAlert', (data) => {
                    this.statistics.motionAlerts++;
                    this.handleMotionAlert(data);
                });
                
                this.socket.on('simpleNotification', (data) => {
                    this.emit('notification', data);
                });
                
                this.socket.on('welcome', (data) => {
                    console.log('Server welcome:', data.message);
                });
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    async startHealthMonitoring() {
        // Initial health check
        await this.performHealthCheck();
        
        // Set up periodic health checks
        setInterval(async () => {
            await this.performHealthCheck();
        }, this.config.healthCheckInterval);
    }
    
    async performHealthCheck() {
        try {
            const status = await this.getSystemStatus();
            this.lastStatus = status;
            this.emit('health_check', { status: 'healthy', data: status });
        } catch (error) {
            this.statistics.errors++;
            this.emit('health_check', { status: 'unhealthy', error: error.message });
        }
    }
    
    async apiCall(endpoint, options = {}) {
        this.statistics.apiCalls++;
        
        try {
            const url = `${this.config.controlApiUrl}${endpoint}`;
            const response = await fetch(url, {
                timeout: 10000,
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            this.statistics.errors++;
            throw error;
        }
    }
    
    // Enhanced API methods
    async getSystemStatus() {
        return await this.apiCall('/status');
    }
    
    async setYoloFiltering(enabled, reason = 'API call') {
        console.log(`Setting YOLO filtering to ${enabled} (${reason})`);
        const result = await this.apiCall('/settings/yolo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        this.emit('yolo_changed', { enabled, reason });
        return result;
    }
    
    async setViewResolution(width, height, reason = 'API call') {
        console.log(`Setting resolution to ${width}x${height} (${reason})`);
        const result = await this.apiCall('/settings/view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ width, height })
        });
        this.emit('resolution_changed', { width, height, reason });
        return result;
    }
    
    async setNotifications(enabled, reason = 'API call') {
        console.log(`Setting notifications to ${enabled} (${reason})`);
        const result = await this.apiCall('/settings/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        this.emit('notifications_changed', { enabled, reason });
        return result;
    }
    
    async getCameras() {
        return await this.apiCall('/cameras');
    }
    
    async getCameraROIs(cameraName) {
        return await this.apiCall(`/cameras/${encodeURIComponent(cameraName)}/rois`);
    }
    
    async addROI(cameraName, roiName, points, reason = 'API call') {
        console.log(`Adding ROI '${roiName}' to camera '${cameraName}' (${reason})`);
        const result = await this.apiCall(`/cameras/${encodeURIComponent(cameraName)}/rois`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: roiName, points })
        });
        this.emit('roi_added', { cameraName, roiName, points, reason });
        return result;
    }
    
    async updateROI(cameraName, roiId, roiName, points, reason = 'API call') {
        console.log(`Updating ROI ${roiId} on camera '${cameraName}' (${reason})`);
        const result = await this.apiCall(`/cameras/${encodeURIComponent(cameraName)}/rois/${roiId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: roiName, points })
        });
        this.emit('roi_updated', { cameraName, roiId, roiName, points, reason });
        return result;
    }
    
    async deleteROI(cameraName, roiId, reason = 'API call') {
        console.log(`Deleting ROI ${roiId} from camera '${cameraName}' (${reason})`);
        const result = await this.apiCall(`/cameras/${encodeURIComponent(cameraName)}/rois/${roiId}`, {
            method: 'DELETE'
        });
        this.emit('roi_deleted', { cameraName, roiId, reason });
        return result;
    }
    
    // Enhanced motion alert handling
    handleMotionAlert(data) {
        const enhancedData = {
            ...data,
            received_at: new Date().toISOString(),
            local_timestamp: Date.now()
        };
        
        console.log(`Motion Alert: ${data.camera_name}/${data.roi_name}`);
        this.emit('motion_alert', enhancedData);
        
        // Emit specific camera events
        this.emit(`motion_alert:${data.camera_name}`, enhancedData);
        this.emit(`motion_alert:${data.camera_name}:${data.roi_name}`, enhancedData);
    }
    
    // Advanced features
    async enableSmartMode() {
        console.log('Enabling smart mode...');
        
        // Enable YOLO filtering and notifications
        await this.setYoloFiltering(true, 'Smart mode activation');
        await this.setNotifications(true, 'Smart mode activation');
        
        this.emit('smart_mode_enabled');
        return { success: true, mode: 'smart' };
    }
    
    async enablePerformanceMode() {
        console.log('Enabling performance mode...');
        
        // Disable YOLO for better performance
        await this.setYoloFiltering(false, 'Performance mode activation');
        await this.setViewResolution(640, 480, 'Performance mode activation');
        
        this.emit('performance_mode_enabled');
        return { success: true, mode: 'performance' };
    }
    
    async scheduleResolutionChange(schedule) {
        console.log('Setting up resolution schedule...');
        
        // Example: Lower resolution at night
        schedule.forEach(item => {
            const delay = new Date(item.time).getTime() - Date.now();
            if (delay > 0) {
                setTimeout(async () => {
                    await this.setViewResolution(
                        item.width, 
                        item.height, 
                        `Scheduled change: ${item.name}`
                    );
                }, delay);
            }
        });
        
        this.emit('schedule_set', schedule);
        return { success: true, scheduled_changes: schedule.length };
    }
    
    // Statistics and monitoring
    getStatistics() {
        return {
            ...this.statistics,
            uptime: Date.now() - this.statistics.startTime,
            connection_status: this.isConnected,
            last_status: this.lastStatus
        };
    }
    
    // Cleanup
    disconnect() {
        console.log('Disconnecting CCTV Controller...');
        
        if (this.socket) {
            this.socket.disconnect();
        }
        
        this.emit('disconnected');
    }
}

export default AdvancedCCTVController;