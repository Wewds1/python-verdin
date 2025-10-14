import requests
import json

def test_mediamtx_v3_complete():
    base_url = "http://localhost:9997"
    
    # Test v3 endpoints systematically
    endpoints = [
        # Config endpoints
        "/v3/config",
        "/v3/config/global", 
        "/v3/config/paths",
        "/v3/config/all",
        
        # Path endpoints
        "/v3/paths",
        "/v3/paths/list",
        "/v3/paths/get",
        "/v3/paths/add",
        
        # Other possible endpoints
        "/v3/api",
        "/v3/status",
        "/v3/info"
    ]
    
    print(f"Testing MediaMTX v3 API endpoints on {base_url}...")
    
    working_endpoints = {}
    
    for endpoint in endpoints:
        url = f"{base_url}{endpoint}"
        try:
            print(f"Testing {url}...")
            response = requests.get(url, timeout=5)
            status = response.status_code
            print(f"   Status: {status}")
            
            if status == 200:
                print(f"   ✅ WORKING! Content: {response.text[:150]}...")
                working_endpoints[endpoint] = {"method": "GET", "status": status}
            elif status == 405:  # Method Not Allowed - might need POST/PATCH
                print(f"   ⚠️ Method not allowed (might need POST/PATCH)")
                working_endpoints[endpoint] = {"method": "POST/PATCH", "status": status}
            elif status == 400:  # Bad Request - endpoint exists but needs parameters
                print(f"   ⚠️ Bad request (endpoint exists, needs parameters)")
                working_endpoints[endpoint] = {"method": "GET", "status": status}
                
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    print(f"\n🎉 Found {len(working_endpoints)} potentially working endpoints:")
    for ep, info in working_endpoints.items():
        print(f"   • {ep} - {info['method']} - Status: {info['status']}")
    
    return working_endpoints

def test_paths_operations():
    base_url = "http://localhost:9997"
    
    print(f"\n🔍 Testing path operations...")
    
    # Test POST to create a path
    test_path_data = {
        "name": "testcamera",
        "source": "rtsp://test.example.com/stream"
    }
    
    endpoints_to_test = [
        ("/v3/paths", "POST"),
        ("/v3/paths/add", "POST"),
        ("/v3/config/paths", "POST"),
        ("/v3/config", "PATCH")
    ]
    
    for endpoint, method in endpoints_to_test:
        url = f"{base_url}{endpoint}"
        try:
            print(f"Testing {method} {url}...")
            if method == "POST":
                response = requests.post(url, json=test_path_data, timeout=5)
            elif method == "PATCH":
                response = requests.patch(url, json={"paths": {"testcamera": {"source": "rtsp://test.example.com/stream"}}}, timeout=5)
            
            print(f"   Status: {response.status_code}")
            if response.status_code not in [404, 500]:
                print(f"   Response: {response.text[:150]}...")
                
        except Exception as e:
            print(f"   ❌ Error: {e}")

if __name__ == "__main__":
    working_endpoints = test_mediamtx_v3_complete()
    test_paths_operations()