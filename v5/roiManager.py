import cv2
import math

class ROIManager:
    def __init__(self, snap_distance, corner_threshold):
        self.snap_distance = snap_distance
        self.corner_threshold = corner_threshold
    
    def handle_mouse_event(self, event, x, y, flags, state, video):
        """Handle mouse events for ROI management"""
        if event == cv2.EVENT_LBUTTONDOWN:
            if not state.edit_mode:
                # Add new point
                snapped_point = self._snap_to_existing_point(x, y, state.current_points)
                if snapped_point:
                    state.current_points.append(snapped_point)
                else:
                    state.current_points.append((x, y))
            else:
                # Edit existing point
                state.selected_points = self._find_nearest_point(x, y, state.current_points)
        
        elif event == cv2.EVENT_MOUSEMOVE and state.edit_mode:
            if state.selected_points is not None and flags & cv2.EVENT_FLAG_LBUTTON:
                # Drag point
                state.current_points[state.selected_points] = (x, y)
        
        elif event == cv2.EVENT_LBUTTONUP and state.edit_mode:
            state.selected_points = None
    
    def _snap_to_existing_point(self, x, y, points):
        """Snap to existing point if close enough"""
        for px, py in points:
            if math.hypot(x - px, y - py) < self.snap_distance:
                return (px, py)
        return None
    
    def _find_nearest_point(self, x, y, points):
        """Find nearest point index"""
        min_dist = float('inf')
        nearest_idx = None
        
        for idx, (px, py) in enumerate(points):
            dist = math.hypot(x - px, y - py)
            if dist < min_dist and dist < self.snap_distance:
                min_dist = dist
                nearest_idx = idx
        
        return nearest_idx
    
    def draw_roi_points(self, frame, current_points, edit_mode=False, selected_roi_idx=None, rois=None):
        """Draw ROI points and lines"""
        # Draw existing ROIs
        if rois:
            for idx, roi in enumerate(rois):
                color = (0, 255, 0)  # Green for normal ROIs
                if edit_mode and selected_roi_idx == idx:
                    color = (0, 255, 255)  # Yellow for selected ROI
                
                # Draw filled polygon
                overlay = frame.copy()
                
                cv2.addWeighted(overlay, 0.3, frame, 0.7, 0, frame)
                
                # Draw outline
                cv2.polylines(frame, [self._points_to_array(roi.points)], True, color, 2)
                
                # Draw label
                if roi.points:
                    label_pos = roi.points[0]
                    cv2.putText(frame, roi.name, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 
                              0.6, color, 2)
        
        # Draw current points being edited/created
        if current_points:
            for i, point in enumerate(current_points):
                cv2.circle(frame, point, 5, (255, 0, 0), -1)
                if i > 0:
                    cv2.line(frame, current_points[i-1], point, (255, 0, 0), 2)
            
            # Draw temporary closing line
            if len(current_points) > 2:
                cv2.line(frame, current_points[-1], current_points[0], (255, 0, 0), 1)
    
    def draw_motion_detections(self, frame, motion_detections):
        """Draw motion detection boxes"""
        for detection in motion_detections:
            try:
                # FIXED: Handle both tuple and dictionary formats
                if isinstance(detection, dict):
                    if 'bbox' in detection:
                        x, y, w, h = detection['bbox']
                    else:
                        # Skip if no bbox
                        continue
                elif isinstance(detection, tuple) and len(detection) == 4:
                    x, y, w, h = detection
                else:
                    # Skip invalid format
                    continue
                
                # Draw motion detection rectangle
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 255), 2)  # Yellow
                
            except Exception as e:
                print(f"Error drawing motion detection: {e}")
                continue
    
    def get_roi_name(self, roi_number):
        """Generate ROI name"""
        return f"ROI_{roi_number}"
    
    def _points_to_array(self, points):
        """Convert points list to numpy array"""
        import numpy as np
        return np.array(points, dtype=np.int32)