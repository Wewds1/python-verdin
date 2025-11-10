from utils import add_roi, get_rois, update_roi, delete_roi, get_camera
from config_manager import config_manager

class ROIManagementSystem:
    def __init__(self):
        self.config = config_manager
    
    def add_roi_to_camera(self, camera_name, roi_name, points):
        """Add ROI to camera with validation"""
        try:
            # Get camera ID
            cameras = get_camera()
            camera_id = None
            for cam in cameras:
                if cam[1] == camera_name:  # cam[1] is camera_name
                    camera_id = cam[0]  # cam[0] is camera_id
                    break
            
            if not camera_id:
                raise ValueError(f"Camera '{camera_name}' not found in database")
            
            # Validate points
            if len(points) < 3:
                raise ValueError("ROI must have at least 3 points")
            
            # Add to database
            roi_id = add_roi(camera_id, roi_name, points)
            
            if roi_id:
                print(f"Added ROI '{roi_name}' to camera '{camera_name}' (ID: {roi_id})")
                return roi_id
            else:
                raise Exception("Failed to add ROI to database")
                
        except Exception as e:
            print(f"Error adding ROI: {e}")
            raise
    
    def list_camera_rois(self, camera_name):
        """List all ROIs for a camera"""
        try:
            # Get camera ID
            cameras = get_camera()
            camera_id = None
            for cam in cameras:
                if cam[1] == camera_name:
                    camera_id = cam[0]
                    break
            
            if not camera_id:
                return []
            
            # Get ROIs
            rois = get_rois(camera_id)
            return rois
            
        except Exception as e:
            print(f"Error listing ROIs: {e}")
            return []
    
    def update_roi_points(self, roi_id, new_name, new_points):
        """Update ROI points"""
        try:
            success = update_roi(roi_id, new_name, new_points)
            if success:
                print(f"Updated ROI {roi_id}")
                return True
            else:
                raise Exception("Failed to update ROI")
        except Exception as e:
            print(f"Error updating ROI: {e}")
            raise
    
    def delete_roi_by_id(self, roi_id):
        """Delete ROI by ID"""
        try:
            success = delete_roi(roi_id)
            if success:
                print(f"Deleted ROI {roi_id}")
                return True
            else:
                raise Exception("Failed to delete ROI")
        except Exception as e:
            print(f"Error deleting ROI: {e}")
            raise

# Global ROI manager
roi_manager = ROIManagementSystem()