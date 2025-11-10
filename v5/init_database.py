import sqlite3
from utils import create_tables
from config import videos

def initialize_system_database():
    """Initialize the complete CCTV database"""
    print("Initializing CCTV System Database...")
    
    # Create all tables
    create_tables()
    
    # Register cameras from config
    from utils import add_camera, get_camera
    
    for video in videos:
        try:
            # Check if camera already exists
            existing_cameras = get_camera()
            camera_exists = any(cam[1] == video.camera_name for cam in existing_cameras)
            
            if not camera_exists:
                camera_id = add_camera(video.camera_name, video.rtsp_link)
                print(f"Registered camera: {video.camera_name} (ID: {camera_id})")
            else:
                print(f"Camera already exists: {video.camera_name}")
                
        except Exception as e:
            print(f"Error registering camera {video.camera_name}: {e}")
    
    print("Database initialization complete!")

if __name__ == "__main__":
    initialize_system_database()