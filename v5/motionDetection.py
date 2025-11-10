import cv2
import numpy as np
import os
import time
import threading
from datetime import datetime
from pathlib import Path
from notifier import WebhookNotifier

class MotionDetector:
    def __init__(self, acceleration_manager):
        self.acceleration_manager = acceleration_manager
        self.cuda_available = acceleration_manager.cuda_available
        self.recordings_dir = Path("recordings")
        self.screenshots_dir = self.recordings_dir / "screenshots"
        self.temp_videos_dir = self.recordings_dir / "temp_videos"
        self.videos_dir = self.recordings_dir / "videos"
        
        # Create directories
        for dir_path in [self.screenshots_dir, self.temp_videos_dir, self.videos_dir]:
            dir_path.mkdir(parents=True, exist_ok=True)
        
        self.notifier = WebhookNotifier()
        self.active_recordings = {}
        self.recording_lock = threading.Lock()
        
        # Motion detection settings
        self.motion_threshold = 2000  # Minimum contour area to consider as motion
        self.notification_cooldown = 30  # Seconds between notifications for same ROI
        self.last_notification_time = {}  # Track last notification per ROI
        
        # NEW: API Control flags
        self.notifications_enabled = True
        
    # NEW: API Control method
    def set_notifications_enabled(self, enabled: bool):
        """Enable/disable notifications via API"""
        self.notifications_enabled = bool(enabled)
        print(f"Motion notifications: {'ENABLED' if self.notifications_enabled else 'DISABLED'}")
        
    def initialize_gpu_memory(self):
        """Initialize GPU memory for CUDA operations"""
        if not self.cuda_available:
            return False, None
            
        try:
            gpu_objects = {
                'background_gpu': None,
                'gray_gpu': cv2.cuda_GpuMat(),
                'fg_mask_gpu': cv2.cuda_GpuMat(),
                'mog2': cv2.cuda.createBackgroundSubtractorMOG2()
            }
            return True, gpu_objects
        except Exception as e:
            print(f"GPU initialization failed: {e}")
            return False, None
    
    def process_cuda_motion(self, frame, rois, gpu_objects, background_set, camera_name, yolo_detections=None):
        """Process motion detection using CUDA with optional YOLO filtering"""
        try:
            if gpu_objects is None:
                return background_set, []
                
            frame_gpu = cv2.cuda_GpuMat()
            frame_gpu.upload(frame)
            
            # Convert to grayscale
            gray_gpu = cv2.cuda.cvtColor(frame_gpu, cv2.COLOR_BGR2GRAY)
            
            # Apply background subtraction
            fg_mask_gpu = gpu_objects['mog2'].apply(gray_gpu, -1)
            
            # Download mask from GPU
            fg_mask = fg_mask_gpu.download()
            
            # Threshold
            _, thresh = cv2.threshold(fg_mask, 25, 255, cv2.THRESH_BINARY)
            
            # Dilate
            kernel = np.ones((5, 5), np.uint8)
            dilated = cv2.dilate(thresh, kernel, iterations=2)
            
            # Find contours
            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            motion_detections = []
            for roi in rois:
                roi_mask = np.zeros(frame.shape[:2], dtype=np.uint8)
                cv2.fillPoly(roi_mask, [np.array(roi.points, dtype=np.int32)], 255)
                
                valid_motion_detected = False
                
                for contour in contours:
                    if cv2.contourArea(contour) > self.motion_threshold:
                        x, y, w, h = cv2.boundingRect(contour)
                        contour_center = (x + w // 2, y + h // 2)
                        
                        if cv2.pointPolygonTest(np.array(roi.points, dtype=np.int32), contour_center, False) >= 0:
                            # Check if motion corresponds to YOLO detection
                            if yolo_detections:
                                if self._motion_has_yolo_object(x, y, w, h, yolo_detections, roi):
                                    valid_motion_detected = True
                                    motion_detections.append({
                                        'roi': roi,
                                        'bbox': (x, y, w, h),
                                        'contour': contour,
                                        'has_object': True
                                    })
                            else:
                                # If no YOLO detections provided, accept all motion
                                valid_motion_detected = True
                                motion_detections.append({
                                    'roi': roi,
                                    'bbox': (x, y, w, h),
                                    'contour': contour,
                                    'has_object': False
                                })
                
                # Only trigger notification if valid motion detected
                if valid_motion_detected:
                    self._handle_motion_event(frame, roi, camera_name)
            
            background_set = True
            return background_set, motion_detections
            
        except Exception as e:
            print(f"CUDA motion detection error: {e}")
            return background_set, []
    
    def process_cpu_motion(self, frame, background_frame, threshold_value=50):
        """Process motion detection on CPU"""
        try:
            # Convert frame to grayscale
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (21, 21), 0)
            # Ensure background frame exists and matches current frame size
            if background_frame is None:
                return gray, []
            
            # Convert background to grayscale if it's not already
            if len(background_frame.shape) == 3:
                bg_gray = cv2.cvtColor(background_frame, cv2.COLOR_BGR2GRAY)
            else:
                bg_gray = background_frame
            
            # Fix: Ensure both frames have the same size
            if gray.shape != bg_gray.shape:
                print(f"Frame size mismatch: current={gray.shape}, background={bg_gray.shape}")
                # Resize background to match current frame
                bg_gray = cv2.resize(bg_gray, (gray.shape[1], gray.shape[0]))
                print(f"Resized background to: {bg_gray.shape}")
            
            # Calculate frame difference
            frame_delta = cv2.absdiff(bg_gray, gray)
            
            # Apply threshold
            thresh = cv2.threshold(frame_delta, threshold_value, 255, cv2.THRESH_BINARY)[1]
            
            # Find contours
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            motion_detections = []
            for contour in contours:
                if cv2.contourArea(contour) > self.motion_threshold:  # Filter small movements
                    x, y, w, h = cv2.boundingRect(contour)
                    # FIXED: Return dictionary format to match expected format
                    motion_detections.append({
                        'bbox': (x, y, w, h),
                        'contour': contour,
                        'has_object': False  # CPU detection doesn't have YOLO info
                    })
            
            return gray, motion_detections
            
        except Exception as e:
            print(f"Error in motion detection: {e}")
            # Return safe defaults
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
            return gray, []

    def filter_detections_by_roi_and_yolo(self, motion_detections, rois, camera_name, yolo_detections=None):
        """Filter motion detections by ROI and optionally by YOLO"""
        filtered_detections = []
        
        for detection in motion_detections:
            # FIXED: Handle both tuple and dict formats
            if isinstance(detection, tuple):
                x, y, w, h = detection
                detection_dict = {
                    'bbox': (x, y, w, h),
                    'has_object': False
                }
            else:
                detection_dict = detection
                x, y, w, h = detection_dict['bbox']
            
            center_x, center_y = x + w//2, y + h//2
            
            # Check if detection is within any ROI
            in_roi = False
            roi_name = None
            
            for roi in rois:
                if self._point_in_polygon((center_x, center_y), roi.points):
                    in_roi = True
                    roi_name = roi.name
                    break
            
            if in_roi:
                # If YOLO filtering is enabled, check for person/vehicle overlap
                if yolo_detections:
                    yolo_overlap = False
                    for yolo_det in yolo_detections:
                        yolo_x, yolo_y, yolo_w, yolo_h = yolo_det['bbox']
                        # Check for overlap
                        if (x < yolo_x + yolo_w and x + w > yolo_x and 
                            y < yolo_y + yolo_h and y + h > yolo_y):
                            yolo_overlap = True
                            break
                    
                    if yolo_overlap:
                        filtered_detections.append(detection_dict)
                        # Send notification
                        self._send_motion_notification(camera_name, roi_name, detection_dict)
                else:
                    # No YOLO filtering, accept all ROI detections
                    filtered_detections.append(detection_dict)
                    # Send notification
                    self._send_motion_notification(camera_name, roi_name, detection_dict)
        
        return filtered_detections

    def _point_in_polygon(self, point, polygon_points):
        """Check if point is inside polygon using ray casting algorithm"""
        x, y = point
        n = len(polygon_points)
        inside = False
        
        p1x, p1y = polygon_points[0]
        for i in range(1, n + 1):
            p2x, p2y = polygon_points[i % n]
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
        
        return inside

    def _send_motion_notification(self, camera_name, roi_name, detection):
        """Send motion notification"""
        if getattr(self, 'notifications_enabled', True):
            try:
                print(f"Motion detected in ROI: {roi_name} for camera {camera_name}")
                # FIXED: Handle detection format
                if isinstance(detection, dict):
                    bbox = detection['bbox']
                else:
                    bbox = detection
                    # Add your webhook notification code here
            except Exception as e:
                print(f"Error sending notification: {e}")
    
    def _motion_has_yolo_object(self, motion_x, motion_y, motion_w, motion_h, yolo_detections, roi):
        """Check if motion area overlaps with any YOLO detected object in the ROI"""
        motion_bbox = (motion_x, motion_y, motion_x + motion_w, motion_y + motion_h)
        
        for detection in yolo_detections:
            yolo_bbox = detection['bbox']  # (x1, y1, x2, y2)
            
            # Check if YOLO detection center is in ROI
            yolo_center_x = (yolo_bbox[0] + yolo_bbox[2]) // 2
            yolo_center_y = (yolo_bbox[1] + yolo_bbox[3]) // 2
            
            if cv2.pointPolygonTest(np.array(roi.points, dtype=np.int32), 
                                   (yolo_center_x, yolo_center_y), False) >= 0:
                # Check if bounding boxes overlap
                if self._boxes_overlap(motion_bbox, yolo_bbox):
                    return True
        
        return False
    
    def _boxes_overlap(self, box1, box2, overlap_threshold=0.3):
        """Check if two bounding boxes overlap"""
        x1_min, y1_min, x1_max, y1_max = box1
        x2_min, y2_min, x2_max, y2_max = box2
        
        # Calculate intersection
        x_left = max(x1_min, x2_min)
        y_top = max(y1_min, y2_min)
        x_right = min(x1_max, x2_max)
        y_bottom = min(y1_max, y2_max)
        
        if x_right < x_left or y_bottom < y_top:
            return False
        
        intersection_area = (x_right - x_left) * (y_bottom - y_top)
        
        box1_area = (x1_max - x1_min) * (y1_max - y1_min)
        box2_area = (x2_max - x2_min) * (y2_max - y2_min)
        
        # Calculate IoU
        iou = intersection_area / float(box1_area + box2_area - intersection_area)
        
        return iou > overlap_threshold
    
    def _handle_motion_event(self, frame, roi, camera_name):
        """Handle motion detection event with cooldown"""
        recording_key = f"{camera_name}_{roi.name}"
        current_time = time.time()
        
        # Check cooldown for notifications
        roi_key = f"{camera_name}_{roi.name}"
        last_notif_time = self.last_notification_time.get(roi_key, 0)
        
        with self.recording_lock:
            if recording_key not in self.active_recordings:
                # Start new recording
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                screenshot_path = self.screenshots_dir / f"{camera_name}_{roi.name}_{timestamp}.jpg"
                temp_video_path = self.temp_videos_dir / f"{camera_name}_{roi.name}_{timestamp}.avi"
                
                # Save screenshot
                cv2.imwrite(str(screenshot_path), frame)
                
                # Initialize video writer
                fourcc = cv2.VideoWriter_fourcc(*'XVID')
                out = cv2.VideoWriter(str(temp_video_path), fourcc, 20.0, (frame.shape[1], frame.shape[0]))
                
                self.active_recordings[recording_key] = {
                    'out': out,
                    'start_time': current_time,
                    'last_motion': current_time,
                    'temp_path': temp_video_path,
                    'screenshot_path': screenshot_path,
                    'notified': False
                }
                
                print(f"Started recording for {camera_name}/{roi.name}")
            else:
                # Update existing recording
                recording = self.active_recordings[recording_key]
                recording['last_motion'] = current_time
                recording['out'].write(frame)
                
                # CHANGED: Check notifications_enabled flag
                should_notify = (
                    self.notifications_enabled and  # NEW: Check if notifications are enabled
                    not recording['notified'] and 
                    (current_time - recording['start_time']) > 2 and
                    (current_time - last_notif_time) > self.notification_cooldown
                )
                
                if should_notify:
                    self.notifier.send_notification(
                        camera_name=camera_name,
                        roi_name=roi.name,
                        screenshot_path=str(recording['screenshot_path']),
                        metadata={
                            'recording_duration': current_time - recording['start_time']
                        }
                    )
                    recording['notified'] = True
                    self.last_notification_time[roi_key] = current_time
                    print(f"Notification sent for {camera_name}/{roi.name}")
    
    def cleanup_recordings(self):
        """Cleanup and finalize recordings that haven't seen motion for 5 seconds"""
        current_time = time.time()
        
        with self.recording_lock:
            keys_to_remove = []
            
            for key, recording in self.active_recordings.items():
                if current_time - recording['last_motion'] > 5:
                    # Finalize recording
                    recording['out'].release()
                    
                    # Move to final location
                    final_path = self.videos_dir / recording['temp_path'].name
                    recording['temp_path'].rename(final_path)
                    
                    print(f"Finalized recording: {final_path}")
                    keys_to_remove.append(key)
            
            for key in keys_to_remove:
                del self.active_recordings[key]