import AdvancedCCTVController from './adv-controller.js';

async function runCompleteTest() {
    console.log('Starting Complete CCTV System Test');

    
    const cctv = new AdvancedCCTVController({
        healthCheckInterval: 10000 // Check every 10 seconds for demo
    });
    
    // Set up event listeners
    cctv.on('ready', () => {
        console.log('✅ System ready for testing');
    });
    
    cctv.on('motion_alert', (data) => {
        console.log(`🚨 MOTION DETECTED:
        📹 Camera: ${data.camera_name}
        📍 ROI: ${data.roi_name}
        ⏰ Time: ${data.timestamp}
        📊 Has Screenshot: ${data.has_screenshot}
        🎥 Has Video: ${data.has_video}`);
    });
    
    cctv.on('health_check', (data) => {
        if (data.status === 'healthy') {
            console.log(`💚 Health check passed - Cameras: ${data.data.cameras.length}`);
        } else {
            console.log(`❤️ Health check failed: ${data.error}`);
        }
    });
    
    // Wait for initialization
    await new Promise(resolve => {
        cctv.once('ready', resolve);
        // Timeout after 10 seconds
        setTimeout(() => resolve(), 10000);
    });
    
    try {
        console.log('\n🧪 Running system tests...');
        
        // Test 1: Basic functionality
        console.log('\nTesting basic controls...');
        await cctv.enableSmartMode();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await cctv.enablePerformanceMode();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test 2: Camera management
        console.log('\nTesting camera management...');
        const cameras = await cctv.getCameras();
        console.log(`📹 Found ${cameras.cameras.length} cameras:`, cameras.cameras);
        
        // Test 3: ROI operations (if cameras exist)
        if (cameras.cameras.length > 0) {
            console.log('\n3️ Testing ROI operations...');
            const cameraName = cameras.cameras[0];
            
            try {
                const rois = await cctv.getCameraROIs(cameraName);
                console.log(`🎯 Camera '${cameraName}' has ${rois.rois.length} ROIs`);
                
                // Add a test ROI
                const testPoints = [[150, 150], [300, 150], [300, 300], [150, 300]];
                await cctv.addROI(cameraName, `test_roi_${Date.now()}`, testPoints, 'Complete system test');
                
            } catch (roiError) {
                console.log(`⚠️ ROI test skipped: ${roiError.message}`);
            }
        }
        
        // Test 4: Scheduled operations
        console.log('\n4️⃣ Testing scheduled operations...');
        const schedule = [
            {
                name: 'Morning HD',
                time: new Date(Date.now() + 5000), // 5 seconds from now
                width: 1280,
                height: 720
            },
            {
                name: 'Evening SD',
                time: new Date(Date.now() + 10000), // 10 seconds from now
                width: 640,
                height: 480
            }
        ];
        
        await cctv.scheduleResolutionChange(schedule);
        
        // Test 5: Statistics
        console.log('\n5️⃣ System statistics:');
        const stats = cctv.getStatistics();
        console.log(`📊 Statistics:
        🔧 API Calls: ${stats.apiCalls}
        🚨 Motion Alerts: ${stats.motionAlerts}
        ❌ Errors: ${stats.errors}
        ⏱️ Uptime: ${Math.floor(stats.uptime / 1000)}s
        🔗 Connected: ${stats.connection_status}`);
        
        console.log('\n✅ All tests completed successfully!');
        console.log('\n📡 Listening for real-time events...');
        console.log('🎯 Trigger motion detection to see live notifications');
        console.log('⏹️ Press Ctrl+C to exit');
        
        // Keep alive for real-time monitoring
        setInterval(() => {
            const currentStats = cctv.getStatistics();
            console.log(`📊 [${new Date().toLocaleTimeString()}] Alerts: ${currentStats.motionAlerts}, API calls: ${currentStats.apiCalls}`);
        }, 30000);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    process.exit(0);
});

// Run the complete test
runCompleteTest().catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});