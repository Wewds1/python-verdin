const CCTVController = require('./cctvController');

async function testCCTV() {
    const cctv = new CCTVController();

    try {
        console.log('Testing CCTV Controller...\n');

        // 1. Initialize database
        console.log('1. Initializing database...');
        const initResult = await cctv.initializeDatabase();
        console.log(initResult);

        // 2. Add a camera to database
        console.log('\n2. Adding camera to database...');
        const addCameraResult = await cctv.addCamera(
            'TestCamera', 
            'rtsp://192.168.1.100:554/stream'
        );
        console.log(addCameraResult);

        // 3. List cameras
        console.log('\n3. Listing cameras...');
        const cameras = await cctv.listCameras();
        console.log(cameras);

        // 4. Add ROI
        console.log('\n4. Adding ROI...');
        const roiPoints = [[100, 100], [200, 100], [200, 200], [100, 200]];
        const addROIResult = await cctv.addROI('TestCamera', 'Entrance', roiPoints);
        console.log(addROIResult);

        // 5. List ROIs
        console.log('\n5. Listing ROIs...');
        const rois = await cctv.listROIs('TestCamera');
        console.log(rois);

        // 6. Start camera (without daemon mode for testing)
        console.log('\n6. Starting camera...');
        const startResult = await cctv.startCamera(
            'TestCamera', 
            'rtsp://192.168.1.100:554/stream',
            { noStreaming: true } // Disable streaming for test
        );
        console.log(startResult);

        // 7. Get camera status
        console.log('\n7. Getting camera status...');
        const status = await cctv.getCameraStatus('TestCamera');
        console.log(status);

        // 8. Enable WhatsApp
        console.log('\n8. Enabling WhatsApp...');
        const whatsappResult = await cctv.enableWhatsApp('TestCamera');
        console.log(whatsappResult);

        // 9. Wait 10 seconds then stop
        console.log('\n9. Waiting 10 seconds then stopping...');
        setTimeout(async () => {
            const stopResult = await cctv.stopCamera('TestCamera');
            console.log('Stop result:', stopResult);
        }, 10000);

    } catch (error) {
        console.error('Error:', error.message);
    }
}

testCCTV();