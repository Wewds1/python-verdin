#!/usr/bin/env python3
import sys
import json
import argparse
import threading
import time
import signal
import os
import cv2
from datetime import datetime

# Import your existing modules
from accelerationManager import AccelerationManager
from motionDetection import MotionDetector
from yoloDetection import YOLODetector
from roiManager import ROIManager
from streamManager import StreamingManager
from config import videos, corner_threshold, snap_distance, server_ip, Camera, ROI, WHATSAPP_CONFIG
from utils import add_roi, get_camera, create_tables, add_camera, update_roi, delete_roi, get_rois
from app import CameraProcessor

class CCTVController:
    def __init__(self):
        self.processor = CameraProcessor()
        self.running_cameras = {}
        self.should_exit = False
        
        # Setup signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        self.should_exit = True
        self.stop_all_cameras()
        sys.exit(0)
    
    # ========== CAMERA OPERATIONS ==========
    def start_camera(self, camera_name, rtsp_url, enable_motion=True, enable_yolo=True, enable_streaming=True):
        """Start camera processing with specified features"""
        try:
            if camera_name in self.running_cameras:
                return {"status": "already_running", "camera": camera_name}
            
            # Register camera in database
            camera_id, rtsp_output = self.processor.register_camera(camera_name, rtsp_url)
            
            # Get ROIs for this camera
            rois_data = get_rois(camera_id) if camera_id else []
            rois = [ROI(roi['name'], roi['points'], roi['id']) for roi in rois_data]
            
            # Create camera object
            camera = Camera(rtsp_url, camera_name, camera_id, rois)
            
            # Start processing in separate thread
            camera_thread = threading.Thread(
                target=self._run_camera_processing,
                args=(camera, enable_motion, enable_yolo, enable_streaming),
                daemon=True
            )
            camera_thread.start()
            
            self.running_cameras[camera_name] = {
                "thread": camera_thread,
                "camera": camera,
                "start_time": datetime.now().isoformat(),
                "motion_enabled": enable_motion,
                "yolo_enabled": enable_yolo,
                "streaming_enabled": enable_streaming
            }
            
            return {
                "status": "started", 
                "camera": camera_name,
                "camera_id": camera_id,
                "rtsp_output": rtsp_output,
                "features": {
                    "motion": enable_motion,
                    "yolo": enable_yolo,
                    "streaming": enable_streaming
                }
            }
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def stop_camera(self, camera_name):
        """Stop camera processing"""
        try:
            if camera_name not in self.running_cameras:
                return {"status": "not_running", "camera": camera_name}
            
            # Mark for stopping
            self.running_cameras[camera_name]["should_stop"] = True
            
            # Wait for graceful shutdown
            time.sleep(2)
            
            # Cleanup
            self.processor.motion_detector.cleanup_recordings()
            del self.running_cameras[camera_name]
            
            return {"status": "stopped", "camera": camera_name}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def stop_all_cameras(self):
        """Stop all running cameras"""
        for camera_name in list(self.running_cameras.keys()):
            self.stop_camera(camera_name)
        return {"status": "all_stopped"}
    
    def get_camera_status(self, camera_name=None):
        """Get status of cameras"""
        try:
            if camera_name:
                if camera_name in self.running_cameras:
                    info = self.running_cameras[camera_name]
                    return {
                        "status": "running",
                        "camera": camera_name,
                        "start_time": info["start_time"],
                        "features": {
                            "motion": info["motion_enabled"],
                            "yolo": info["yolo_enabled"],
                            "streaming": info["streaming_enabled"]
                        }
                    }
                else:
                    return {"status": "not_running", "camera": camera_name}
            else:
                # Return all cameras status
                status = {}
                for name, info in self.running_cameras.items():
                    status[name] = {
                        "status": "running",
                        "start_time": info["start_time"],
                        "features": {
                            "motion": info["motion_enabled"],
                            "yolo": info["yolo_enabled"],
                            "streaming": info["streaming_enabled"]
                        }
                    }
                return {"cameras": status}
                
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    # ========== ROI OPERATIONS ==========
    def add_roi(self, camera_name, roi_name, points):
        """Add ROI to camera"""
        try:
            # Get camera ID
            camera_id = self.processor.get_camera_dbid(camera_name)
            if camera_id is None:
                return {"status": "error", "message": f"Camera {camera_name} not found"}
            
            # Add ROI to database
            roi_id = add_roi(camera_id, roi_name, points)
            
            if roi_id:
                # Update running camera if it exists
                if camera_name in self.running_cameras:
                    camera = self.running_cameras[camera_name]["camera"]
                    new_roi = ROI(roi_name, points, roi_id)
                    camera.rois.append(new_roi)
                
                return {
                    "status": "success", 
                    "roi_id": roi_id, 
                    "camera": camera_name, 
                    "roi_name": roi_name
                }
            else:
                return {"status": "error", "message": "Failed to add ROI"}
                
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def update_roi(self, roi_id, roi_name, points):
        """Update existing ROI"""
        try:
            success = update_roi(roi_id, roi_name, points)
            if success:
                # Update in running cameras
                for camera_info in self.running_cameras.values():
                    camera = camera_info["camera"]
                    for roi in camera.rois:
                        if roi.id == roi_id:
                            roi.name = roi_name
                            roi.points = points
                            break
                
                return {"status": "success", "roi_id": roi_id}
            else:
                return {"status": "error", "message": "Failed to update ROI"}
                
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def delete_roi(self, roi_id):
        """Delete ROI"""
        try:
            success = delete_roi(roi_id)
            if success:
                # Remove from running cameras
                for camera_info in self.running_cameras.values():
                    camera = camera_info["camera"]
                    camera.rois = [roi for roi in camera.rois if roi.id != roi_id]
                
                return {"status": "success", "roi_id": roi_id}
            else:
                return {"status": "error", "message": "Failed to delete ROI"}
                
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def list_rois(self, camera_name):
        """List all ROIs for a camera"""
        try:
            camera_id = self.processor.get_camera_dbid(camera_name)
            if camera_id is None:
                return {"status": "error", "message": f"Camera {camera_name} not found"}
            
            rois = get_rois(camera_id)
            return {"status": "success", "camera": camera_name, "rois": rois}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    # ========== WHATSAPP OPERATIONS ==========
    def toggle_whatsapp(self, camera_name, enabled):
        """Enable/disable WhatsApp notifications"""
        try:
            if enabled:
                self.processor.motion_detector.whatsapp_enabled = True
                if not self.processor.motion_detector.whatsapp and WHATSAPP_CONFIG.get('enabled'):
                    from sender import WhatsAppNotifier
                    self.processor.motion_detector.whatsapp = WhatsAppNotifier(
                        WHATSAPP_CONFIG['access_token'],
                        WHATSAPP_CONFIG['phone_number_id']
                    )
                    self.processor.motion_detector.recipient_number = WHATSAPP_CONFIG['recipient_number']
            else:
                self.processor.motion_detector.whatsapp_enabled = False
            
            return {"status": "success", "whatsapp_enabled": enabled, "camera": camera_name}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    # ========== FEATURE TOGGLES ==========
    def toggle_motion_detection(self, camera_name, enabled):
        """Enable/disable motion detection for camera"""
        try:
            if camera_name in self.running_cameras:
                self.running_cameras[camera_name]["motion_enabled"] = enabled
                return {"status": "success", "motion_enabled": enabled, "camera": camera_name}
            else:
                return {"status": "error", "message": f"Camera {camera_name} not running"}
                
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def toggle_yolo_detection(self, camera_name, enabled):
        """Enable/disable YOLO detection for camera"""
        try:
            if camera_name in self.running_cameras:
                self.running_cameras[camera_name]["yolo_enabled"] = enabled
                return {"status": "success", "yolo_enabled": enabled, "camera": camera_name}
            else:
                return {"status": "error", "message": f"Camera {camera_name} not running"}
                
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def toggle_streaming(self, camera_name, enabled):
        """Enable/disable streaming for camera"""
        try:
            if camera_name in self.running_cameras:
                self.running_cameras[camera_name]["streaming_enabled"] = enabled
                return {"status": "success", "streaming_enabled": enabled, "camera": camera_name}
            else:
                return {"status": "error", "message": f"Camera {camera_name} not running"}
                
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    # ========== DATABASE OPERATIONS ==========
    def list_cameras(self):
        """List all cameras in database"""
        try:
            cameras = get_camera()
            return {
                "status": "success", 
                "cameras": [
                    {
                        "id": cam[0],
                        "name": cam[1],
                        "rtsp_input": cam[2],
                        "rtsp_output": cam[4] if len(cam) > 4 else None
                    } for cam in cameras
                ]
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def add_camera_to_db(self, camera_name, rtsp_input, rtsp_output=None):
        """Add camera to database"""
        try:
            if rtsp_output is None:
                rtsp_output = f"rtsp://{server_ip}:8554/live/{camera_name}"
            
            camera_id = add_camera(camera_name, rtsp_input, None, rtsp_output)
            return {
                "status": "success",
                "camera_id": camera_id,
                "camera_name": camera_name,
                "rtsp_output": rtsp_output
            }
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    # ========== INTERNAL METHODS ==========
    def _run_camera_processing(self, camera, enable_motion, enable_yolo, enable_streaming):
        """Internal method to run camera processing"""
        try:
            video_cap = cv2.VideoCapture(camera.rtsp_link, cv2.CAP_FFMPEG)
            video_cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            if not video_cap.isOpened():
                print(f"Failed to open camera {camera.camera_name}")
                return
            
            # Initialize components
            ffmpeg = None
            if enable_streaming:
                ffmpeg = self.processor.streaming_manager.start_ffmpeg(camera.rtsp_output)
            
            gpu_initialized, gpu_objects = self.processor.motion_detector.initialize_gpu_memory()
            background_frame = None
            background_set = False
            
            print(f"Started processing for {camera.camera_name}")
            
            while not self.should_exit and not self.running_cameras.get(camera.camera_name, {}).get("should_stop", False):
                success, frame = video_cap.read()
                if not success or frame is None:
                    time.sleep(0.1)
                    continue
                
                frame = cv2.resize(frame, (1280, 720))
                
                # Get current settings
                camera_info = self.running_cameras.get(camera.camera_name, {})
                current_motion = camera_info.get("motion_enabled", enable_motion)
                current_yolo = camera_info.get("yolo_enabled", enable_yolo)
                current_streaming = camera_info.get("streaming_enabled", enable_streaming)
                
                # YOLO detection
                if current_yolo:
                    yolo_detections = self.processor.yolo_detector.detect(frame)
                    self.processor.yolo_detector.draw_detections(frame, yolo_detections)
                
                # Motion detection
                if current_motion:
                    if gpu_initialized:
                        background_set, motion_detections = self.processor.motion_detector.process_cuda_motion(
                            frame, camera.rois, gpu_objects, background_set, camera.camera_name
                        )
                    else:
                        background_frame, motion_detections = self.processor.motion_detector.process_cpu_motion(
                            frame, camera.rois, background_frame, camera.camera_name
                        )
                
                # Streaming
                if current_streaming and ffmpeg:
                    ffmpeg = self.processor.streaming_manager.write_frame(ffmpeg, frame, camera.rtsp_output)
                
                time.sleep(0.03)  # ~30 FPS
            
            # Cleanup
            video_cap.release()
            if ffmpeg:
                try:
                    ffmpeg.stdin.close()
                    ffmpeg.wait()
                except:
                    pass
            
            print(f"Stopped processing for {camera.camera_name}")
            
        except Exception as e:
            print(f"Error processing camera {camera.camera_name}: {e}")

def main():
    parser = argparse.ArgumentParser(description='CCTV Control System CLI')
    parser.add_argument('command', choices=[
        # Camera operations
        'start-camera', 'stop-camera', 'stop-all', 'camera-status', 'list-cameras', 'add-camera',
        # ROI operations
        'add-roi', 'update-roi', 'delete-roi', 'list-rois',
        # Feature toggles
        'motion-on', 'motion-off', 'yolo-on', 'yolo-off', 'streaming-on', 'streaming-off',
        'whatsapp-on', 'whatsapp-off',
        # Utility
        'init-db'
    ])
    
    # Camera arguments
    parser.add_argument('--camera', help='Camera name')
    parser.add_argument('--rtsp-input', help='RTSP input URL')
    parser.add_argument('--rtsp-output', help='RTSP output URL')
    parser.add_argument('--no-motion', action='store_true', help='Disable motion detection')
    parser.add_argument('--no-yolo', action='store_true', help='Disable YOLO detection')
    parser.add_argument('--no-streaming', action='store_true', help='Disable streaming')
    parser.add_argument('--daemon', action='store_true', help='Run in daemon mode')
    
    # ROI arguments
    parser.add_argument('--roi-name', help='ROI name')
    parser.add_argument('--roi-id', type=int, help='ROI ID')
    parser.add_argument('--points', help='ROI points as JSON string')
    
    args = parser.parse_args()
    
    controller = CCTVController()
    
    try:
        # Camera operations
        if args.command == 'start-camera':
            if not args.camera or not args.rtsp_input:
                print(json.dumps({"status": "error", "message": "Camera name and RTSP input required"}))
                return
            
            result = controller.start_camera(
                args.camera, 
                args.rtsp_input,
                enable_motion=not args.no_motion,
                enable_yolo=not args.no_yolo,
                enable_streaming=not args.no_streaming
            )
            
            if args.daemon and result.get("status") == "started":
                try:
                    while not controller.should_exit:
                        time.sleep(1)
                except KeyboardInterrupt:
                    controller.stop_all_cameras()
        
        elif args.command == 'stop-camera':
            if not args.camera:
                print(json.dumps({"status": "error", "message": "Camera name required"}))
                return
            result = controller.stop_camera(args.camera)
        
        elif args.command == 'stop-all':
            result = controller.stop_all_cameras()
        
        elif args.command == 'camera-status':
            result = controller.get_camera_status(args.camera)
        
        elif args.command == 'list-cameras':
            result = controller.list_cameras()
        
        elif args.command == 'add-camera':
            if not args.camera or not args.rtsp_input:
                print(json.dumps({"status": "error", "message": "Camera name and RTSP input required"}))
                return
            result = controller.add_camera_to_db(args.camera, args.rtsp_input, args.rtsp_output)
        
        # ROI operations
        elif args.command == 'add-roi':
            if not all([args.camera, args.roi_name, args.points]):
                print(json.dumps({"status": "error", "message": "Camera, ROI name, and points required"}))
                return
            points = json.loads(args.points)
            result = controller.add_roi(args.camera, args.roi_name, points)
        
        elif args.command == 'update-roi':
            if not all([args.roi_id, args.roi_name, args.points]):
                print(json.dumps({"status": "error", "message": "ROI ID, name, and points required"}))
                return
            points = json.loads(args.points)
            result = controller.update_roi(args.roi_id, args.roi_name, points)
        
        elif args.command == 'delete-roi':
            if not args.roi_id:
                print(json.dumps({"status": "error", "message": "ROI ID required"}))
                return
            result = controller.delete_roi(args.roi_id)
        
        elif args.command == 'list-rois':
            if not args.camera:
                print(json.dumps({"status": "error", "message": "Camera name required"}))
                return
            result = controller.list_rois(args.camera)
        
        # Feature toggles
        elif args.command == 'motion-on':
            result = controller.toggle_motion_detection(args.camera, True)
        elif args.command == 'motion-off':
            result = controller.toggle_motion_detection(args.camera, False)
        elif args.command == 'yolo-on':
            result = controller.toggle_yolo_detection(args.camera, True)
        elif args.command == 'yolo-off':
            result = controller.toggle_yolo_detection(args.camera, False)
        elif args.command == 'streaming-on':
            result = controller.toggle_streaming(args.camera, True)
        elif args.command == 'streaming-off':
            result = controller.toggle_streaming(args.camera, False)
        elif args.command == 'whatsapp-on':
            result = controller.toggle_whatsapp(args.camera, True)
        elif args.command == 'whatsapp-off':
            result = controller.toggle_whatsapp(args.camera, False)
        
        # Utility
        elif args.command == 'init-db':
            create_tables()
            result = {"status": "success", "message": "Database initialized"}
        
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    main()