import CCTVController from './cctvController.js';

async function simpleTest() {
    console.log('🔧 Simple CCTV Test');
    
    const cctv = new CCTVController();
    
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
        // Test each endpoint individually with delays
        console.log('\n1. Testing status...');
        const status = await cctv.getStatus();
        console.log('✓ Status:', status);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log('\n2. Testing YOLO disable...');
        await cctv.setYoloFiltering(false);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n3. Testing YOLO enable...');
        await cctv.setYoloFiltering(true);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n4. Testing notifications disable...');
        await cctv.setNotifications(false);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('\n5. Testing notifications enable...');
        await cctv.setNotifications(true);
        
        console.log('\n✅ All basic tests passed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
    
    process.exit(0);
}

simpleTest();