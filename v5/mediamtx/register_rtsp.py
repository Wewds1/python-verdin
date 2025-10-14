import requests
import json
import argparse
import sys

class MediaMTXRegistrar:
    def __init__(self, api_url):
        self.api_url = api_url.rstrip('/')
        self.api_version = "v3"  # MediaMTX v1.14.0 uses v3

    def register_rtsp_path(self, path_name, rtsp_source, overwrite=False):
        """Register path using MediaMTX v1.14.0 API"""
        
        # Check if path exists first (if not overwriting)
        if not overwrite:
            existing_paths = self._get_existing_paths()
            if existing_paths and any(item.get('name') == path_name for item in existing_paths):
                print(f"Path '{path_name}' already exists. Use --overwrite to replace.")
                return False
        
        # Try different methods to register the path
        methods = [
            ("POST", f"/{self.api_version}/paths/{path_name}"),
            ("PUT", f"/{self.api_version}/paths/{path_name}"),
            ("PATCH", f"/{self.api_version}/paths/{path_name}"),
        ]
        
        for method, endpoint in methods:
            try:
                url = f"{self.api_url}{endpoint}"
                data = {"source": rtsp_source}
                
                print(f"Trying {method} {endpoint}...")
                
                if method == "POST":
                    response = requests.post(url, json=data, timeout=10)
                elif method == "PUT":
                    response = requests.put(url, json=data, timeout=10)
                elif method == "PATCH":
                    response = requests.patch(url, json=data, timeout=10)
                
                print(f"   Status: {response.status_code}")
                
                if response.status_code in [200, 201]:
                    print(f" Successfully registered path '{path_name}'")
                    print(f"   Source: {rtsp_source}")
                    print(f"   Access via: rtsp://localhost:8554/{path_name}")
                    return True
                elif response.status_code == 409:
                    print(f"Path '{path_name}' already exists")
                    if overwrite:
                        print(f"   Continuing with overwrite...")
                        continue
                    else:
                        print(f"   Use --overwrite to replace existing path")
                        return False
                else:
                    print(f"   Response: {response.text[:150]}...")
                    
            except Exception as e:
                print(f" Error: {e}")
        
        print(f"Failed to register path '{path_name}' with all methods")
        print("Try manually adding to mediamtx.yml and restart MediaMTX")
        return False

    def _get_existing_paths(self):
        """Helper to get existing paths"""
        try:
            response = requests.get(f"{self.api_url}/{self.api_version}/paths/list")
            if response.status_code == 200:
                data = response.json()
                return data.get('items', [])
        except:
            pass
        return []

    def list_paths(self):
        """List paths using the working v3/paths/list endpoint"""
        try:
            response = requests.get(f"{self.api_url}/{self.api_version}/paths/list")
            if response.status_code == 200:
                data = response.json()
                items = data.get('items', [])
                item_count = data.get('itemCount', 0)
                
                print(f"Registered Paths ({item_count} total):")
                
                if items:
                    for item in items:
                        name = item.get('name', 'Unknown')
                        source = item.get('source', 'N/A')
                        print(f"   • {name}")
                        print(f"     Source: {source}")
                        print(f"     Access: rtsp://localhost:8554/{name}")
                        print()
                else:
                    print("   No paths registered yet.")
                return True
            else:
                print(f"Failed to list paths: {response.status_code} {response.text}")
                return False
        except Exception as e:
            print(f"Error listing paths: {e}")
            return False

    def remove_path(self, path_name):
        """Remove a path using DELETE method"""
        try:
            # Try direct DELETE
            url = f"{self.api_url}/{self.api_version}/paths/{path_name}"
            print(f"🔍 Removing path '{path_name}'...")
            
            response = requests.delete(url, timeout=10)
            
            if response.status_code in [200, 204]:
                print(f"Successfully removed path '{path_name}'")
                return True
            elif response.status_code == 404:
                print(f"Path '{path_name}' not found")
                return False
            else:
                print(f"Failed to remove path: {response.status_code}")
                print(f"Response: {response.text}")
                return False
                
        except Exception as e:
            print(f"Error removing path: {e}")
            return False

    def test_connection(self):
        """Test connection using the known working endpoint"""
        try:
            print(f"🔍 Testing connection to {self.api_url}...")
            
            # Test the known working endpoint
            response = requests.get(f"{self.api_url}/{self.api_version}/paths/list", timeout=5)
            
            if response.status_code == 200:
                print(f"Connection successful!")
                print(f"MediaMTX API {self.api_version} is working")
                data = response.json()
                item_count = data.get('itemCount', 0)
                print(f"Currently {item_count} paths registered")
                return True
            else:
                print(f"Connection failed: {response.status_code}")
                print(f"   Response: {response.text}")
                print("Make sure:")
                print("   1. MediaMTX is running")
                print("   2. API is enabled (api: true in mediamtx.yml)")
                print("   3. API address is :9997")
                return False
                
        except requests.exceptions.ConnectionError:
            print(f"Cannot connect to {self.api_url}")
            print("Check if MediaMTX is running and API is enabled")
            return False
        except Exception as e:
            print(f"Connection error: {e}")
            return False

    def get_config(self):
        """Legacy method - MediaMTX v1.14.0 doesn't have config endpoint"""
        print("Config endpoint not available in MediaMTX v1.14.0")
        print("Use 'list' command to see registered paths")
        return None

def main():
    parser = argparse.ArgumentParser(description="MediaMTX v1.14.0 RTSP Path Registrar")
    parser.add_argument('--api-url', default='http://localhost:9997', 
                       help='MediaMTX API URL (default: http://localhost:9997)')

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    register_parser = subparsers.add_parser('register', help='Register a new RTSP path')
    register_parser.add_argument('path_name', help="Path name (e.g: camera1)")
    register_parser.add_argument('rtsp_source', help="RTSP source URL")
    register_parser.add_argument('--overwrite', action='store_true', help='Overwrite existing path')

    list_parser = subparsers.add_parser('list', help='List all registered paths')
    remove_parser = subparsers.add_parser('remove', help='Remove a registered path')
    remove_parser.add_argument('path_name', help='Path name to remove')

    test_parser = subparsers.add_parser('test', help='Test connection to MediaMTX API')

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(1)

    args = parser.parse_args()

    mtx = MediaMTXRegistrar(args.api_url)

    if args.command == 'register':
        success = mtx.register_rtsp_path(args.path_name, args.rtsp_source, overwrite=args.overwrite)
        sys.exit(0 if success else 1)

    elif args.command == 'list':
        success = mtx.list_paths()
        sys.exit(0 if success else 1)

    elif args.command == 'remove':
        success = mtx.remove_path(args.path_name)
        sys.exit(0 if success else 1)

    elif args.command == 'test':
        success = mtx.test_connection()
        sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()