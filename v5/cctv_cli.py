#!/usr/bin/env python3
import sys
import json
import argparse
import threading
import time
import signal
import logging
from datetime import datetime
import cv2
import requests

# Import your existing modules
from accelerationManager import AccelerationManager
from motionDetection import MotionDetector
from yoloDetection import YOLODetector
from roiManager import ROIManager
from streamManager import StreamingManager
from config import videos, corner_threshold, snap_distance, server_ip, Camera, ROI, WHATSAPP_CONFIG
from utils import add_roi, get_camera, create_tables, add_camera, update_roi, delete_roi, get_rois
from app import CameraProcessor

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


class CCTVController:
    def __init__(self):
        try:
            self.processor = CameraProcessor()
        except Exception as e:
            logging.error(f"Failed to initialize CameraProcessor: {e}")
            self.processor = None
        self.running_cameras = {}
        self.should_exit = False

        # Setup signal handlers
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

    def signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        logging.info("Shutdown signal received. Stopping all cameras...")
        self.should_exit = True
        self.stop_all_cameras()
        sys.exit(0)

    # ========== CAMERA OPERATIONS ==========
    def start_camera(self, camera_name, rtsp_url, enable_motion=True, enable_yolo=True, enable_whatsapp=False, api_url=None):
        if camera_name in self.running_cameras:
            return self.json_response("already_running", f"Camera '{camera_name}' is already running.")

        if self.processor is None:
            return self.json_response("error", "CameraProcessor failed to initialize. Check YOLO model.")

        try:
            # Register the RTSP stream with MediaMTX API if provided
            if api_url:
                self.register_rtsp(api_url, camera_name, rtsp_url)

            # Create a Camera object for processing
            camera_obj = Camera(rtsp_url, camera_name, camera_name, [])
            
            # Start processing thread
            processing_thread = threading.Thread(
                target=self._run_camera_processing,
                args=(camera_obj, enable_motion, enable_yolo, True),
                daemon=True
            )
            processing_thread.start()

            # Store camera details
            self.running_cameras[camera_name] = {
                "thread": processing_thread,
                "start_time": datetime.now().isoformat(),
                "motion_enabled": enable_motion,
                "yolo_enabled": enable_yolo,
                "whatsapp_enabled": enable_whatsapp,
                "should_stop": False
            }

            logging.info(f"Camera '{camera_name}' started successfully with motion={enable_motion}, yolo={enable_yolo}, whatsapp={enable_whatsapp}")
            return self.json_response("started", f"Camera '{camera_name}' started successfully.", {
                "motion": enable_motion,
                "yolo": enable_yolo,
                "whatsapp": enable_whatsapp
            })
        except Exception as e:
            logging.error(f"Error starting camera '{camera_name}': {e}")
            return self.json_response("error", str(e))
    def stop_camera(self, camera_name):
        if camera_name not in self.running_cameras:
            return self.json_response("not_running", f"Camera '{camera_name}' is not running.")

        try:
            # Set stop flag
            self.running_cameras[camera_name]["should_stop"] = True
            
            # Wait for thread to finish
            thread = self.running_cameras[camera_name].get("thread")
            if thread and thread.is_alive():
                thread.join(timeout=5)
            
            # Force terminate FFmpeg process if exists
            process = self.running_cameras[camera_name].get("process")
            if process:
                try:
                    process.terminate()
                    process.wait(timeout=3)
                except:
                    process.kill()
            
            del self.running_cameras[camera_name]
            logging.info(f"Camera '{camera_name}' stopped successfully.")
            return self.json_response("stopped", f"Camera '{camera_name}' stopped successfully.")

        except Exception as e:
            logging.error(f"Error stopping camera '{camera_name}': {e}")
            return self.json_response("error", str(e))

    def stop_all_cameras(self):
        """Stop all running cameras"""
        for camera_name in list(self.running_cameras.keys()):
            self.stop_camera(camera_name)
        logging.info("All cameras stopped successfully.")
        return self.json_response("all_stopped", "All cameras stopped successfully.")
    
    def register_rtsp(self, api_url, camera_name, rtsp_url):
        """
        Register or update a path in MediaMTX via PATCH to /paths/{camera_name}.
        If the API is not available or fails, log the error but do not raise.
        """
        import requests
        import json
        try:
            # Remove trailing slash if present
            if api_url.endswith('/'):
                api_url = api_url[:-1]
            patch_url = f"{api_url}/paths/{camera_name}"
            payload = {"source": rtsp_url}
            headers = {"Content-Type": "application/json"}
            response = requests.patch(patch_url, headers=headers, data=json.dumps(payload))
            if response.status_code in (200, 201):
                logging.info(f"RTSP path '{camera_name}' registered/updated successfully in MediaMTX.")
            else:
                logging.error(f"Failed to register RTSP path '{camera_name}' in MediaMTX: {response.status_code} {response.text}")
        except Exception as e:
            logging.error(f"Error registering RTSP path for '{camera_name}': {e}")

    def send_whatsapp_notification(self, message):
        """Send WhatsApp notification using the config"""
        try:
            if not WHATSAPP_CONFIG.get('enabled', False):
                return
                
            url = f"https://graph.facebook.com/v15.0/{WHATSAPP_CONFIG['phone_number_id']}/messages"
            headers = {
                "Authorization": f"Bearer {WHATSAPP_CONFIG['access_token']}",
                "Content-Type": "application/json"
            }
            payload = {
                "messaging_product": "whatsapp",
                "to": WHATSAPP_CONFIG['recipient_number'],
                "type": "text",
                "text": {"body": message}
            }
            response = requests.post(url, headers=headers, json=payload)
            if response.status_code == 200:
                logging.info(f"WhatsApp notification sent: {message}")
            else:
                logging.error(f"Failed to send WhatsApp notification: {response.text}")
        except Exception as e:
            logging.error(f"Error sending WhatsApp notification: {e}")

    # ========== INTERNAL METHODS ==========
    def _run_camera_processing(self, camera, enable_motion, enable_yolo, enable_streaming):
        """Internal method to run camera processing"""
        try:
            video_cap = cv2.VideoCapture(camera.rtsp_link, cv2.CAP_FFMPEG)
            video_cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            if not video_cap.isOpened():
                logging.error(f"Failed to open camera '{camera.camera_name}'.")
                return

            # Initialize components
            ffmpeg = None
            if enable_streaming:
                streaming_manager = StreamingManager()
                ffmpeg = streaming_manager.start_ffmpeg(camera.rtsp_link, camera.rtsp_output)

            gpu_initialized, gpu_objects = self.processor.motion_detector.initialize_gpu_memory()
            background_frame = None
            background_set = False

            logging.info(f"Started processing for camera '{camera.camera_name}'.")

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
                    
                    # Add WhatsApp notification for YOLO detection
                    if yolo_detections and camera_info.get("whatsapp_enabled", False):
                        self.send_whatsapp_notification(f"Object detected on camera {camera.camera_name}")

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
                    
                    # Add WhatsApp notification for motion detection
                    if motion_detections and camera_info.get("whatsapp_enabled", False):
                        self.send_whatsapp_notification(f"Motion detected on camera {camera.camera_name}")

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

            logging.info(f"Stopped processing for camera '{camera.camera_name}'.")

        except Exception as e:
            logging.error(f"Error processing camera '{camera.camera_name}': {e}")

    @staticmethod
    def json_response(status, message=None, data=None):
        """Helper method to format JSON-like responses."""
        response = {"status": status}
        if message:
            response["message"] = message
        if data:
            response["data"] = data
        return json.dumps(response)

def main():
    parser = argparse.ArgumentParser(description='CCTV Monitoring System CLI')
    parser.add_argument('command', choices=[
        'start-camera', 'stop-camera', 'stop-all', 'init-db'
    ], help="Command to execute")
    parser.add_argument('--camera', help='Camera name')
    parser.add_argument('--rtsp-input', help='RTSP input URL')
    parser.add_argument('--motion-detection', action='store_true', help='Enable motion detection')
    parser.add_argument('--yolo-detection', action='store_true', help='Enable YOLO detection')
    parser.add_argument('--whatsapp', action='store_true', help='Enable WhatsApp notifications')
    parser.add_argument('--api-url', help='MediaMTX API URL for RTSP registration')

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(1)

    args = parser.parse_args()
    controller = CCTVController()

    try:
        if args.command == 'start-camera':
            if not args.camera or not args.rtsp_input:
                print(controller.json_response("error", "Camera name and RTSP input are required."))
                return
            result = controller.start_camera(
                camera_name=args.camera,
                rtsp_url=args.rtsp_input,
                enable_motion=args.motion_detection,
                enable_yolo=args.yolo_detection,
                enable_whatsapp=args.whatsapp,
                api_url=args.api_url
            )
            print(result)

        elif args.command == 'stop-camera':
            if not args.camera:
                print(controller.json_response("error", "Camera name is required."))
                return
            result = controller.stop_camera(args.camera)
            print(result)

        elif args.command == 'stop-all':
            result = controller.stop_all_cameras()
            print(result)

        elif args.command == 'init-db':
            create_tables()
            print(controller.json_response("success", "Database initialized successfully."))

    except Exception as e:
        logging.error(f"Error executing command: {e}")
        print(controller.json_response("error", str(e)))


if __name__ == "__main__":
    main()