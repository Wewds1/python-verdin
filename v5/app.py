import cv2
import sys
import math
import threading
from typing import Dict
from accelerationManager import AccelerationManager
from motionDetection import MotionDetector
from yoloDetection import YOLODetector
from roiManager import ROIManager
from streamManager import StreamingManager
from config import videos, corner_threshold, snap_distance, server_ip, Camera, ROI
from utils import add_roi, get_camera, create_tables, add_camera, update_roi, delete_roi, get_rois

class CameraProcessor:
    def __init__(self):
        self.acceleration_manager = AccelerationManager()
        self.motion_detector = MotionDetector(self.acceleration_manager)
        self.yolo_detector = YOLODetector(self.acceleration_manager.load_yolo_model())
        self.roi_manager = ROIManager(snap_distance, corner_threshold)
        self.streaming_manager = StreamingManager(self.acceleration_manager.cuda_available)
        self.cleanup_thread = None
        self.running = True
        
        # Configuration flags
        self.use_yolo_filtering = True  # Set to True to only notify on person/vehicle detection
        self.yolo_classes_to_detect = [0, 1, 2, 3, 5, 7]  # person, bicycle, car, motorcycle, bus, truck
        
        # NEW: API Control variables
        self.view_resolution = (1280, 720)  # Default resolution
        self.videos_index: Dict[str, Camera] = {}  # Track cameras by name for API access
        
    # NEW: API Control methods
    def set_yolo_filtering(self, enabled: bool):
        """Enable/disable YOLO filtering"""
        try:
            self.use_yolo_filtering = bool(enabled)
            print(f"YOLO filtering: {'ENABLED' if enabled else 'DISABLED'}")
        except Exception as e:
            print(f"Error setting YOLO filtering: {e}")
            raise

    def set_view_resolution(self, width: int, height: int):
        """Set display resolution"""
        try:
            self.view_resolution = (int(width), int(height))
            print(f"View resolution set to {self.view_resolution}")
        except Exception as e:
            print(f"Error setting view resolution: {e}")
            raise

    def set_notifications_enabled(self, enabled: bool):
        """Enable/disable notifications"""
        try:
            if hasattr(self.motion_detector, 'set_notifications_enabled'):
                self.motion_detector.set_notifications_enabled(enabled)
            else:
                self.motion_detector.notifications_enabled = bool(enabled)
            return {"success": True, "enabled": enabled}
        except Exception as e:
            print(f"Error setting notifications: {e}")
            raise

    def refresh_rois(self, camera_name: str):
        """Refresh ROIs for a camera from database"""
        try:
            cam_id = self.get_camera_dbid(camera_name)
            if cam_id is None:
                return False
            rois = get_rois(cam_id)
            if camera_name in self.videos_index:
                video = self.videos_index[camera_name]
                video.rois = [ROI(roi['name'], roi['points'], roi['id']) for roi in rois]
                return True
            return False
        except Exception as e:
            print(f"Error refreshing ROIs: {e}")
            return False

    def list_cameras(self):
        """Get list of active camera names"""
        try:
            # Return both active cameras and database cameras
            active_cameras = list(self.videos_index.keys())
            db_cameras = []
            
            try:
                from utils import get_camera
                cameras = get_camera()
                db_cameras = [cam[1] for cam in cameras]  # cam[1] is camera name
            except:
                pass
            
            # Combine and deduplicate
            all_cameras = list(set(active_cameras + db_cameras))
            return all_cameras
        except Exception as e:
            print(f"Error listing cameras: {e}")
            return []

    def get_camera_status(self):
        """Get current system status"""
        try:
            return {
                "yolo_filtering": getattr(self, 'use_yolo_filtering', True),
                "view_resolution": list(getattr(self, 'view_resolution', (1280, 720))),
                "notifications_enabled": getattr(self.motion_detector, 'notifications_enabled', True),
                "cameras": self.list_cameras(),
                "yolo_classes": getattr(self, 'yolo_classes_to_detect', [0, 1, 2, 3, 5, 7])
            }
        except Exception as e:
            print(f"Error getting camera status: {e}")
            raise

        
    def start_cleanup_thread(self):
        """Start background thread for cleanup"""
        def cleanup_loop():
            import time
            while self.running:
                self.motion_detector.cleanup_recordings()
                time.sleep(1)
        
        self.cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
        self.cleanup_thread.start()
    
    def get_camera_dbid(self, camera_name):
        for cam in get_camera():
            if cam[1] == camera_name:
                return cam[0]
        return None

    def register_camera(self, camera_name, rtsp_link):
        for cam in get_camera():
            if cam[1] == camera_name:
                return cam[0], cam[4]
        rtsp_output = f"rtsp://{server_ip}:8554/live/{camera_name}"
        camera_id = add_camera(camera_name, rtsp_link, None, rtsp_output)
        return camera_id, rtsp_output
    
    def process_video(self, video):
        # Setup
        camera_id = self.get_camera_dbid(video.camera_name)
        if camera_id is None:
            camera_id, rtsp_output = self.register_camera(video.camera_name, video.rtsp_link)
            video.camera_id = camera_id
            
        rois = get_rois(camera_id) if camera_id is not None else []
        video.rois = [ROI(roi['name'], roi['points'], roi['id']) for roi in rois]
        
        # NEW: Register camera in index for API access
        self.videos_index[video.camera_name] = video
        
        video_cap = cv2.VideoCapture(video.rtsp_link, cv2.CAP_FFMPEG)
        video_cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        if not video_cap.isOpened():
            print(f"Failed to open camera: {video.camera_name}")
            return

        # Initialize components
        ffmpeg = self.streaming_manager.start_ffmpeg(video.rtsp_output)
        if ffmpeg is None:
            video_cap.release()
            return
            
        gpu_initialized, gpu_objects = self.motion_detector.initialize_gpu_memory()
        
        # State variables (thread-local)
        class State:
            def __init__(self):
                self.edit_mode = False
                self.selected_roi_idx = None
                self.background_frame = None
                self.background_set = False
                self.current_points = []
                self.selected_points = None
        
        state = State()
        window_name = f"Motion Detection - {video.camera_name}"
        
        # Setup UI
        cv2.namedWindow(window_name)
        param = {'shape': (720, 1280), 'state': state, 'video': video}
        
        def mouse_callback(event, x, y, flags, param):
            self.roi_manager.handle_mouse_event(
                event, x, y, flags, param['state'], param['video']
            )
        
        cv2.setMouseCallback(window_name, mouse_callback, param)
        
        # Main processing loop
        try:
            while self.running:
                success, frame = video_cap.read()
                if not success or frame is None or frame.shape[0] == 0:
                    continue

                # CHANGED: Use configurable resolution
                frame = cv2.resize(frame, self.view_resolution)
                param['shape'] = frame.shape[:2]
                corners = [(0, 0), (frame.shape[1]-1, 0), (frame.shape[1]-1, frame.shape[0]-1), (0, frame.shape[0]-1)]

                # Initialize background frame
                if state.background_frame is None:
                    state.background_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    print(f"Initialized background frame for {video.camera_name}: {state.background_frame.shape}")
                    continue

                # Ensure background frame matches current frame size
                if len(state.background_frame.shape) == 3:
                    bg_gray = cv2.cvtColor(state.background_frame, cv2.COLOR_BGR2GRAY)
                else:
                    bg_gray = state.background_frame
                    
                current_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                
                if bg_gray.shape != current_gray.shape:
                    print(f"Updating background frame size from {bg_gray.shape} to {current_gray.shape}")
                    state.background_frame = current_gray.copy()
                    continue

                # YOLO detection
                yolo_detections = self.yolo_detector.detect(frame)
                
                # Filter YOLO detections by class
                if self.use_yolo_filtering:
                    filtered_yolo = [d for d in yolo_detections if d['class_id'] in self.yolo_classes_to_detect]
                else:
                    filtered_yolo = None  # Don't filter, accept all motion
                
                self.yolo_detector.draw_detections(frame, yolo_detections)

                # ROI visualization
                self.roi_manager.draw_roi_points(frame, state.current_points, state.edit_mode, state.selected_roi_idx, video.rois)

                # Add missing motion_threshold attribute
                if not hasattr(self, 'motion_threshold'):
                    self.motion_threshold = 25

                # Motion detection - Fixed method call
                state.background_frame, motion_detections = self.motion_detector.process_cpu_motion(
                    frame, state.background_frame, self.motion_threshold
                )
                
                # Apply ROI and YOLO filtering to motion detections
                if motion_detections and hasattr(self.motion_detector, 'filter_detections_by_roi_and_yolo'):
                    motion_detections = self.motion_detector.filter_detections_by_roi_and_yolo(
                        motion_detections, video.rois, video.camera_name, filtered_yolo
                    )
                
                if motion_detections:
                    self.roi_manager.draw_motion_detections(frame, motion_detections)

                # Display detection info
                yolo_count = len(yolo_detections)
                filtered_count = len(filtered_yolo) if filtered_yolo else 0
                motion_count = len(motion_detections)
                
                # Show notifications status
                notif_status = "ON" if getattr(self.motion_detector, 'notifications_enabled', True) else "OFF"
                info_text = f"YOLO: {yolo_count} | Filtered: {filtered_count} | Motion: {motion_count} | Filter: {'ON' if self.use_yolo_filtering else 'OFF'} | Notify: {notif_status}"
                cv2.putText(frame, info_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

                # Streaming
                ffmpeg = self.streaming_manager.write_frame(ffmpeg, frame, video.rtsp_output)
                if ffmpeg is None:
                    break

                # Handle keyboard input
                key = cv2.waitKey(1)
                if self._handle_keyboard_input(key, state, corners, camera_id, video, 
                                              gpu_initialized, gpu_objects):
                    break

                cv2.imshow(window_name, frame)

        except Exception as e:
            print(f"Error processing video {video.camera_name}: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self._cleanup(video_cap, window_name, ffmpeg, gpu_objects)
    
    def _handle_keyboard_input(self, key, state, corners, camera_id, video, 
                              gpu_initialized, gpu_objects):
        # Add ROI
        if not state.edit_mode and key == 13 and len(state.current_points) > 2:
            self._add_roi(state, corners, camera_id, video, gpu_initialized, gpu_objects)
        
        # Edit mode toggle
        elif key & 0xFF == ord('e') and video.rois:
            state.edit_mode = True
            state.selected_roi_idx = 0
            state.current_points.clear()
            state.current_points.extend(video.rois[state.selected_roi_idx].points.copy())
        
        # Cycle through ROIs in edit mode
        elif state.edit_mode and key & 0xFF == ord('n') and len(video.rois) > 1:
            state.selected_roi_idx = (state.selected_roi_idx + 1) % len(video.rois)
            state.current_points.clear()
            state.current_points.extend(video.rois[state.selected_roi_idx].points.copy())
        
        # Update ROI
        elif state.edit_mode and key == 13 and len(state.current_points) > 2:
            self._update_roi(state, video, gpu_initialized, gpu_objects)
            state.edit_mode = False
            state.selected_roi_idx = None
        
        # Delete ROI
        elif state.edit_mode and key & 0xFF == ord('d') and state.selected_roi_idx is not None:
            self._delete_roi(state, video)
            state.edit_mode = False
            state.selected_roi_idx = None
        
        # Cancel edit mode
        elif state.edit_mode and key == 27:  # ESC key
            state.edit_mode = False
            state.selected_roi_idx = None
            state.current_points.clear()
        
        # Toggle YOLO filtering
        elif key & 0xFF == ord('f'):
            self.use_yolo_filtering = not self.use_yolo_filtering
            print(f"YOLO filtering: {'ENABLED' if self.use_yolo_filtering else 'DISABLED'}")
        
        # NEW: Toggle notifications
        elif key & 0xFF == ord('n'):
            self.set_notifications_enabled(not self.motion_detector.notifications_enabled)
        
        # Quit
        elif key & 0xFF == ord('q'):
            return True
            
        return False
    
    def _add_roi(self, state, corners, camera_id, video, gpu_initialized, gpu_objects):
        for cx, cy in corners:
            first_dist = math.hypot(state.current_points[0][0] - cx, state.current_points[0][1] - cy)
            last_dist = math.hypot(state.current_points[-1][0] - cx, state.current_points[-1][1] - cy)
            if first_dist < corner_threshold and last_dist < corner_threshold:
                state.current_points.append((cx, cy))
                break

        roi_name = self.roi_manager.get_roi_name(len(video.rois) + 1)
        roi_id = add_roi(camera_id, roi_name, state.current_points)
        if roi_id:
            video.add_roi(ROI(roi_name, state.current_points.copy(), roi_id))
            state.current_points.clear()
            if gpu_initialized and gpu_objects:
                state.background_set = False
                gpu_objects['mog2'] = cv2.cuda.createBackgroundSubtractorMOG2()
            else:
                state.background_frame = None
    
    def _update_roi(self, state, video, gpu_initialized, gpu_objects):
        if state.selected_roi_idx is not None:
            roi = video.rois[state.selected_roi_idx]
            success = update_roi(roi.id, roi.name, state.current_points)
            if success:
                roi.points = state.current_points.copy()
            state.current_points.clear()
            if gpu_initialized and gpu_objects:
                state.background_set = False
                gpu_objects['mog2'] = cv2.cuda.createBackgroundSubtractorMOG2()
            else:
                state.background_frame = None
    
    def _delete_roi(self, state, video):
        if state.selected_roi_idx is not None and state.selected_roi_idx < len(video.rois):
            roi = video.rois[state.selected_roi_idx]
            success = delete_roi(roi.id)
            if success:
                video.remove_roi(roi.id)
                state.current_points.clear()
    
    def _cleanup(self, video_cap, window_name, ffmpeg, gpu_objects):
        """Cleanup resources"""
        try:
            video_cap.release()
        except:
            pass
        
        try:
            cv2.destroyWindow(window_name)
        except:
            pass
        
        try:
            if ffmpeg:
                ffmpeg.stdin.close()
                ffmpeg.wait(timeout=5)
        except:
            pass
        
        # Cleanup GPU objects
        if gpu_objects:
            try:
                for key in gpu_objects:
                    if gpu_objects[key] is not None:
                        del gpu_objects[key]
            except:
                pass

if __name__ == "__main__":
    processor = CameraProcessor()
    create_tables()
    processor.start_cleanup_thread()
    
    # Start control API with better error handling
    api_started = False
    try:
        import control_api
        control_api.start_api(processor, host="0.0.0.0", port=5001)
        api_started = True
        print("✓ Control API started at http://localhost:5001")
        print("✓ API docs available at http://localhost:5001/docs")
    except ImportError as e:
        print("⚠ FastAPI not installed. Install with: pip install fastapi uvicorn")
        print(f"  Error: {e}")
    except Exception as e:
        print(f"✗ Control API failed to start: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        if len(sys.argv) >= 3:
            rtsp_link = sys.argv[1]
            camera_name = sys.argv[2]
            camera_id, rtsp_output = processor.register_camera(camera_name, rtsp_link)
            video = Camera(rtsp_link, camera_name, camera_id, rois=[])
            processor.process_video(video)
        else:
            threads = []
            for video in videos:
                t = threading.Thread(target=processor.process_video, args=(video,), daemon=True)
                t.start()
                threads.append(t)
            
            # Keep main thread alive if API is running
            if api_started:
                print("CCTV system running with API control")
                print("Monitor at: http://localhost:5001/docs")
                print("Control via JavaScript: cctvController.js")
                print("Press Ctrl+C to stop")
            
            for t in threads:
                t.join()
    except KeyboardInterrupt:
        print("\nShutting down...")
        processor.running = False
        try:
            import control_api
            control_api.stop_api()
        except:
            pass
    finally:
        cv2.destroyAllWindows()