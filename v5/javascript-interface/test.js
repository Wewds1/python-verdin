import CCTVController from './cctvController.js';

async function runTests() {
    console.log('='.repeat(60));
    console.log('🎥 CCTV Controller Test Suite');
    console.log('='.repeat(60));
    
    // Initialize controller
    console.log('🔧 Initializing CCTV Controller...');
    const cctv = new CCTVController();
    
    // Wait for initialization
    console.log('⏳ Waiting for connections...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
        // Test 1: Get Status
        console.log('\n📊 Test 1: Getting system status...');
        const status = await cctv.getStatus();
        console.log('   ✓ Status:', JSON.stringify(status, null, 2));
        
        // Test 2: Toggle YOLO filtering
        console.log('\n🤖 Test 2: Testing YOLO filtering toggle...');
        await cctv.setYoloFiltering(false);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await cctv.setYoloFiltering(true);
        
        // Test 3: Change view resolution
        console.log('\n📺 Test 3: Testing view resolution change...');
        await cctv.setViewResolution(640, 480);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await cctv.setViewResolution(1280, 720);
        
        // Test 4: Toggle notifications
        console.log('\n🔔 Test 4: Testing notifications toggle...');
        await cctv.setNotifications(false);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await cctv.setNotifications(true);
        
        // Test 5: Get cameras
        console.log('\n📹 Test 5: Getting camera list...');
        const cameras = await cctv.getCameras();
        console.log('   ✓ Cameras:', JSON.stringify(cameras, null, 2));
        
        // Test 6: Test connections
        console.log('\n🌐 Test 6: Testing connections...');
        const connectionTest = await cctv.testConnection();
        console.log('   ✓ Connection test result:', connectionTest);
        
        // Test 7: ROI operations (if cameras exist)
        if (cameras.cameras && cameras.cameras.length > 0) {
            const cameraName = cameras.cameras[0];
            console.log(`\n🎯 Test 7: Testing ROI operations for camera '${cameraName}'...`);
            
            try {
                // Get existing ROIs
                const rois = await cctv.getCameraROIs(cameraName);
                console.log('   ✓ Existing ROIs:', JSON.stringify(rois, null, 2));
                
                // Add a test ROI
                const testPoints = [[100, 100], [200, 100], [200, 200], [100, 200]];
                const addResult = await cctv.addROI(cameraName, 'test_roi_js', testPoints);
                console.log('   ✓ ROI added:', addResult);
                
            } catch (roiError) {
                console.log('   ⚠ ROI operations skipped:', roiError.message);
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ All tests completed successfully!');
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
    }
    
    // Listen for real-time events
    console.log('\n📡 Listening for real-time events...');
    console.log('   🎯 Trigger motion detection in your CCTV app to see events here');
    console.log('   🚪 Press Ctrl+C to exit\n');
    
    cctv.on('motionAlert', (data) => {
        console.log('\n🚨 MOTION ALERT RECEIVED:');
        console.log('   📹 Camera:', data.camera_name);
        console.log('   📍 ROI:', data.roi_name);
        console.log('   ⏰ Time:', data.timestamp);
        console.log('   📊 Metadata:', data.metadata);
        console.log('');
    });
    
    cctv.on('simpleNotification', (data) => {
        console.log('\n📢 NOTIFICATION RECEIVED:');
        console.log('   💬 Message:', data.message);
        console.log('   ⏰ Time:', data.timestamp);
        console.log('');
    });
    
    cctv.on('connected', () => {
        console.log('🔗 WebSocket connected');
    });
    
    cctv.on('disconnected', () => {
        console.log('🔗 WebSocket disconnected');
    });
}

// Handle exit gracefully
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    process.exit(0);
});

// Handle unhandled errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Run the tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});