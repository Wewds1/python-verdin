import cv2
import numpy as np
import tkinter
from tkinter.simpledialog import askstring

class ROIManager:
    def __init__(self, snap_distance=10, corner_threshold=50):
        self.snap_distance = snap_distance
        self.corner_threshold = corner_threshold
        
    def get_roi_name(self, default_count=1):
        root = tkinter.Tk()
        root.withdraw()
        roi_name = askstring("ROI Name", "Enter the name for the new ROI:")
        if roi_name is None or roi_name.strip() == "":
            roi_name = f"ROI_{default_count}"
    
        # Sanitize the ROI name
        roi_name = self._sanitize_roi_name(roi_name)
        return roi_name
    def point_in_roi(self, point, shape):
        pts = np.array(shape, dtype=np.int32)
        return cv2.pointPolygonTest(pts, point, False) >= 0
    
    def create_mouse_callback(self, current_points, selected_points, edit_mode, selected_roi_idx, video_rois):
        def mouse_callback(event, x, y, flags, param):
            nonlocal current_points, selected_points, edit_mode, selected_roi_idx
            h, w = param['shape']
            corners = [(0, 0), (w-1, 0), (w-1, h-1), (0, h-1)]
            
            if event == cv2.EVENT_LBUTTONDOWN:
                for cx, cy in corners:
                    if abs(x - cx) < self.snap_distance and abs(y - cy) < self.snap_distance:
                        current_points.append((cx, cy))
                        selected_points = None
                        return
                for idx, point in enumerate(current_points):
                    if abs(point[0] - x) < 10 and abs(point[1] - y) < 10:
                        selected_points = idx
                        return
                current_points.append((x, y))
                selected_points = None
            elif event == cv2.EVENT_MOUSEMOVE and selected_points is not None:
                current_points[selected_points] = (x, y)
            elif event == cv2.EVENT_LBUTTONUP:
                selected_points = None
            elif event == cv2.EVENT_RBUTTONDOWN:
                current_points.clear()
            elif edit_mode and event == cv2.EVENT_MOUSEMOVE:
                for idx, roi in enumerate(video_rois):
                    if self.point_in_roi((x, y), roi.points):
                        selected_roi_idx = idx
                        current_points.clear()
                        current_points.extend(roi.points.copy())
                        break
        return mouse_callback
    
    def draw_roi_points(self, frame, current_points):
        for pt in current_points:
            cv2.circle(frame, pt, 5, (0, 255, 255), -1)
        if len(current_points) > 1:
            cv2.polylines(frame, [np.array(current_points)], False, (0, 255, 0), 1)
    
    def draw_motion_detections(self, frame, detections):
        for detection in detections:
            x, y, w, h = detection['bbox']
            roi_name = detection['roi_name']
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            cv2.putText(frame, roi_name, (x, y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
    def _sanitize_roi_name(self, name):
        """Sanitize ROI name to prevent file system issues"""
        import re
        # Replace invalid characters with underscores
        invalid_chars = r'[<>:"/\\|?*]'
        sanitized = re.sub(invalid_chars, '_', name)
        
        # Remove any trailing dots or spaces
        sanitized = sanitized.rstrip('. ')
        
        # Ensure name is not empty
        if not sanitized:
            sanitized = "ROI"
        
        return sanitized