import cv2
import numpy as np
import os
import time
import threading
import datetime
import imutils
import subprocess
from sender import WhatsAppNotifier
from config import WHATSAPP_CONFIG

class MotionDetector:
    def __init__(self, acceleration_manager, save_path='recordings/', save_screenshots=True, save_videos=True, video_duration=10):
        self.acceleration_manager = acceleration_manager
        self.subtract_images = acceleration_manager.get_subtract_function()
        self.use_cuda = acceleration_manager.cuda_available
        self.use_opencl = acceleration_manager.opencl_available

        # Recording Settings
        self.save_path = save_path
        self.save_screenshots = save_screenshots
        self.save_videos = save_videos
        self.video_duration = video_duration

        # Recording Directories
        self.screenshot_dir = os.path.join(save_path, 'screenshots')
        self.video_path = os.path.join(save_path, 'videos')
        self.temp_video_dir = os.path.join(save_path, 'temp_videos')
        os.makedirs(self.screenshot_dir, exist_ok=True)
        os.makedirs(self.video_path, exist_ok=True)
        os.makedirs(self.temp_video_dir, exist_ok=True)

        # Video Recording State
        self.active_recordings = {}
        self.recording_timers = {}
        self.last_detection_time = {}

        # WhatsApp Notifier 
        self.whatsapp_enabled = WHATSAPP_CONFIG.get('enabled', False)
        if self.whatsapp_enabled:
            self.whatsapp = WhatsAppNotifier(
                access_token=WHATSAPP_CONFIG['access_token'],
                phone_number_id=WHATSAPP_CONFIG['phone_number_id']
            )
            self.recipient_number = WHATSAPP_CONFIG['recipient_number']
        else:
            self.whatsapp = None

        # Motion consistency tracking
        self.roi_motion_start_times = {}
        self.roi_last_screenshot_time = {}
        self.roi_last_whatsapp_time = {}
        self.screenshot_cooldown = 5.0
        self.whatsapp_cooldown = 10.0
        self.motion_consistency_duration = 1.0
        
    def initialize_gpu_memory(self, height=720, width=1280):
        if not self.use_cuda:
            return False, {}
            
        try:
            gpu_objects = {
                'gpu_frame': cv2.cuda_GpuMat(height, width, cv2.CV_8UC3),
                'gpu_gray': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'gpu_background': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'gpu_mask': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'gpu_roi_gray': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'gpu_roi_background': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'gpu_diff': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'gpu_thresh': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'gpu_dilated': cv2.cuda_GpuMat(height, width, cv2.CV_8UC1),
                'kernel': cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            }
            return True, gpu_objects
        except Exception as e:
            print(f"GPU initialization failed: {e}")
            return False, {}
    
    def process_cuda_motion(self, frame, rois, gpu_objects, background_set, camera_name):
        try:
            gpu_objects['gpu_frame'].upload(frame)
            cv2.cuda.cvtColor(gpu_objects['gpu_frame'], gpu_objects['gpu_gray'], cv2.COLOR_BGR2GRAY)
            
            if not background_set:
                gpu_objects['gpu_gray'].copyTo(gpu_objects['gpu_background'])
                return True, []
            
            detections = []
            for roi in rois:
                detection = self._process_roi_cuda(frame, roi, gpu_objects, camera_name)
                if detection:
                    detections.extend(detection)
                    
            return background_set, detections
        except Exception as e:
            print(f"CUDA motion processing error: {e}")
            return background_set, []
    
    def _process_roi_cuda(self, frame, roi, gpu_objects, camera_name):
        try:
            pts = np.array(roi.points, dtype=np.int32)
            cv2.polylines(frame, [pts], isClosed=True, color=(255, 0, 0), thickness=2)
            
            mask = np.zeros((720, 1280), dtype=np.uint8)
            cv2.fillPoly(mask, [pts], 255)
            gpu_objects['gpu_mask'].upload(mask)
            
            cv2.cuda.bitwise_and(gpu_objects['gpu_gray'], gpu_objects['gpu_mask'], gpu_objects['gpu_roi_gray'])
            cv2.cuda.bitwise_and(gpu_objects['gpu_background'], gpu_objects['gpu_mask'], gpu_objects['gpu_roi_background'])
            cv2.cuda.absdiff(gpu_objects['gpu_roi_background'], gpu_objects['gpu_roi_gray'], gpu_objects['gpu_diff'])
            cv2.cuda.threshold(gpu_objects['gpu_diff'], gpu_objects['gpu_thresh'], 50, 255, cv2.THRESH_BINARY)
            cv2.cuda.dilate(gpu_objects['gpu_thresh'], gpu_objects['gpu_dilated'], gpu_objects['kernel'], iterations=2)
            
            dilated_image = gpu_objects['gpu_dilated'].download()
            
            return self._find_contours(dilated_image, roi.name, frame, camera_name)
        except Exception as e:
            print(f"CUDA ROI processing error: {e}")
            return []
    
    def process_cpu_motion(self, frame, rois, background_frame, camera_name):
        try:
            if self.use_opencl:
                gray_frame = cv2.cvtColor(cv2.UMat(frame), cv2.COLOR_BGR2GRAY).get()
            else:
                gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                
            if background_frame is None:
                return gray_frame, []
            
            detections = []
            for roi in rois:
                detection = self._process_roi_cpu(frame, roi, gray_frame, background_frame, camera_name)
                if detection:
                    detections.extend(detection)
                    
            return background_frame, detections
        except Exception as e:
            print(f"CPU motion processing error: {e}")
            return background_frame, []
    
    def _process_roi_cpu(self, frame, roi, gray_frame, background_frame, camera_name):
        try:
            pts = np.array(roi.points, dtype=np.int32)
            cv2.polylines(frame, [pts], isClosed=True, color=(255, 0, 0), thickness=2)
            
            mask = np.zeros_like(gray_frame)
            cv2.fillPoly(mask, [pts], 255)
            
            roi_gray = cv2.bitwise_and(gray_frame, mask)
            roi_background = cv2.bitwise_and(background_frame, mask)
            diff, thresh = self.subtract_images(roi_background, roi_gray)
            
            if thresh is None or thresh.size == 0:
                return []
                
            dilated_image = cv2.dilate(thresh, None, iterations=2)
            return self._find_contours(dilated_image, roi.name, frame, camera_name)
        except Exception as e:
            print(f"CPU ROI processing error: {e}")
            return []
    
    def _find_contours(self, dilated_image, roi_name, frame, camera_name, min_area=3000):
        if dilated_image is None or dilated_image.size == 0:
            return []
            
        try:
            cnts = cv2.findContours(dilated_image, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cnts = imutils.grab_contours(cnts)
            
            detections = []
            motion_detected = False
            for c in cnts:
                if cv2.contourArea(c) < min_area:
                    continue
                x, y, w, h = cv2.boundingRect(c)
                detections.append({
                    'bbox': (x, y, w, h),
                    'roi_name': roi_name
                })
                motion_detected = True 

            if motion_detected:
                self._handle_motion_detection_with_consistency(frame, roi_name, camera_name)
            else:
                roi_key = f"{camera_name}_{roi_name}"
                if roi_key in self.roi_motion_start_times:
                    del self.roi_motion_start_times[roi_key]
                    
            return detections
        except Exception as e:
            print(f"Contour detection error: {e}")
            return []

    def _handle_motion_detection_with_consistency(self, frame, roi_name, camera_name):
        """Enhanced motion detection with 1-second consistency rule"""
        current_time = time.time()
        roi_key = f"{camera_name}_{roi_name}"
        
        # Track motion start time
        if roi_key not in self.roi_motion_start_times:
            self.roi_motion_start_times[roi_key] = current_time
        
        # Calculate motion duration
        motion_duration = current_time - self.roi_motion_start_times[roi_key]
        
        # Only proceed if motion is consistent for 1 second
        if motion_duration >= self.motion_consistency_duration:
            self.last_detection_time[roi_key] = current_time
            
            # Handle screenshot with cooldown
            if self.save_screenshots:
                self._save_screenshot_with_cooldown(frame, roi_name, camera_name, current_time)
            
            # Handle video recording
            if self.save_videos:
                self._handle_video_recording(frame, roi_name, camera_name, roi_key)

    def _save_screenshot_with_cooldown(self, frame, roi_name, camera_name, current_time):
        """Save screenshot with cooldown check"""
        roi_key = f"{camera_name}_{roi_name}"
        last_screenshot = self.roi_last_screenshot_time.get(roi_key, 0)
        
        if current_time - last_screenshot >= self.screenshot_cooldown:
            self._save_screenshot(frame, roi_name, camera_name)
            self.roi_last_screenshot_time[roi_key] = current_time

    def _save_screenshot(self, frame, roi_name, camera_name):
        try:
            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]
            filename = f"{camera_name}_{roi_name}_{timestamp}.jpg"
            filepath = os.path.join(self.screenshot_dir, filename)

            annotated_frame = frame.copy()
            cv2.putText(annotated_frame, f"Motion in {roi_name}", (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            cv2.putText(annotated_frame, timestamp, (10, 70), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            cv2.imwrite(filepath, annotated_frame)
            print(f"Screenshot saved: {filepath}")
        except Exception as e:
            print(f"Screenshot save error: {e}")

    def _handle_video_recording(self, frame, roi_name, camera_name, roi_key):
        try:
            if roi_key not in self.active_recordings:
                self._start_video_recording(roi_key, roi_name, camera_name, frame.shape)

            if roi_key in self.active_recordings:
                recording_info = self.active_recordings[roi_key]
                video_writer = recording_info['writer']
                
                annotated_frame = frame.copy()
                cv2.putText(annotated_frame, f"Recording: {roi_name}", (10, 30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                timestamp = datetime.datetime.now().strftime('%H:%M:%S')
                cv2.putText(annotated_frame, timestamp, (10, 70), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                
                video_writer.write(annotated_frame)

                if roi_key in self.recording_timers:
                    self.recording_timers[roi_key].cancel()

                self.recording_timers[roi_key] = threading.Timer(
                    self.video_duration, 
                    self._stop_video_recording, 
                    args=[roi_key]
                )
                self.recording_timers[roi_key].start()
        except Exception as e:
            print(f"Video recording error: {e}")

    def _start_video_recording(self, roi_key, roi_name, camera_name, frame_shape):
        """Enhanced video recording with WhatsApp-compatible format"""
        try:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # Create temporary raw video first
            temp_filename = f"{camera_name}_{roi_name}_{timestamp}_temp.avi"
            temp_filepath = os.path.join(self.temp_video_dir, temp_filename)
            
            # Final WhatsApp-compatible video
            final_filename = f"{camera_name}_{roi_name}_{timestamp}.mp4"
            final_filepath = os.path.join(self.video_path, final_filename)

            # Use MJPEG for temporary recording (faster)
            fourcc = cv2.VideoWriter_fourcc(*'MJPG')
            height, width = frame_shape[:2]
            fps = 25.0

            video_writer = cv2.VideoWriter(temp_filepath, fourcc, fps, (width, height))

            if video_writer.isOpened():
                self.active_recordings[roi_key] = {
                    'writer': video_writer,
                    'temp_path': temp_filepath,
                    'final_path': final_filepath,
                    'start_time': time.time()
                }
                print(f"Started recording video for {roi_key} at {temp_filepath}")
            else:
                print(f"Failed to start video recording for {roi_key}")
        except Exception as e:
            print(f"Video start error: {e}")

    def _stop_video_recording(self, roi_key):
        """Enhanced stop recording with H.264 conversion for WhatsApp"""
        try:
            if roi_key in self.active_recordings:
                recording_info = self.active_recordings[roi_key]
                video_writer = recording_info['writer']
                temp_path = recording_info['temp_path']
                final_path = recording_info['final_path']
                
                # Release the video writer
                video_writer.release()
                del self.active_recordings[roi_key]
                
                print(f"Stopped recording for {roi_key}, converting to H.264...")
                
                # Convert to WhatsApp-compatible format in background
                threading.Thread(
                    target=self._convert_video_for_whatsapp,
                    args=(temp_path, final_path, roi_key),
                    daemon=True
                ).start()
                
            if roi_key in self.recording_timers:
                del self.recording_timers[roi_key]
        except Exception as e:
            print(f"Video stop error: {e}")

    def _convert_video_for_whatsapp(self, temp_path, final_path, roi_key):
        """Convert video to WhatsApp-compatible H.264 format"""
        try:
            # FFmpeg command for WhatsApp-compatible video
            cmd = [
                'ffmpeg', '-y',
                '-i', temp_path,
                '-c:v', 'libx264',          # H.264 codec
                '-preset', 'fast',          # Fast encoding
                '-crf', '23',               # Good quality
                '-profile:v', 'baseline',   # Baseline profile for compatibility
                '-level', '3.0',            # Level 3.0 for compatibility
                '-pix_fmt', 'yuv420p',      # Pixel format for compatibility
                '-movflags', '+faststart',  # Optimize for streaming
                '-max_muxing_queue_size', '1024',  # Handle encoding buffer
                final_path
            ]
            
            # Run FFmpeg conversion
            result = subprocess.run(
                cmd, 
                capture_output=True, 
                text=True, 
                timeout=60  # 60 second timeout
            )
            
            if result.returncode == 0:
                print(f"Video converted successfully: {final_path}")
                
                # Clean up temporary file
                try:
                    os.remove(temp_path)
                except:
                    pass
                
                # Verify file size (WhatsApp limit: 16MB)
                file_size = os.path.getsize(final_path)
                if file_size > 16 * 1024 * 1024:  # 16MB
                    print(f"Warning: Video file too large for WhatsApp: {file_size / (1024*1024):.2f}MB")
                    # Try to compress further
                    self._compress_video_further(final_path, roi_key)
                else:
                    # Send WhatsApp notification
                    if self.whatsapp_enabled and self.whatsapp:
                        self._send_whatsapp_notification_for_file(final_path, roi_key)
            else:
                print(f"FFmpeg conversion failed: {result.stderr}")
                # Clean up temp file
                try:
                    os.remove(temp_path)
                except:
                    pass
                
        except subprocess.TimeoutExpired:
            print(f"Video conversion timeout for {roi_key}")
        except Exception as e:
            print(f"Error converting video for {roi_key}: {e}")

    def _compress_video_further(self, video_path, roi_key):
        """Further compress video if it's too large for WhatsApp"""
        try:
            compressed_path = video_path.replace('.mp4', '_compressed.mp4')
            
            cmd = [
                'ffmpeg', '-y',
                '-i', video_path,
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '28',               # Higher CRF for more compression
                '-profile:v', 'baseline',
                '-level', '3.0',
                '-pix_fmt', 'yuv420p',
                '-vf', 'scale=640:480',     # Reduce resolution
                '-r', '15',                 # Reduce framerate
                '-movflags', '+faststart',
                '-max_muxing_queue_size', '1024',
                compressed_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            
            if result.returncode == 0:
                # Replace original with compressed version
                os.remove(video_path)
                os.rename(compressed_path, video_path)
                print(f"Video compressed successfully: {video_path}")
                
                # Send WhatsApp notification
                if self.whatsapp_enabled and self.whatsapp:
                    self._send_whatsapp_notification_for_file(video_path, roi_key)
            else:
                print(f"Video compression failed: {result.stderr}")
                
        except Exception as e:
            print(f"Error compressing video: {e}")

    def _send_whatsapp_notification_for_file(self, video_path, roi_key):
        """Send WhatsApp notification for a specific video file"""
        try:
            current_time = time.time()
            last_whatsapp = self.roi_last_whatsapp_time.get(roi_key, 0)
            
            # Check cooldown
            if current_time - last_whatsapp < self.whatsapp_cooldown:
                print(f"WhatsApp cooldown active for {roi_key}. Waiting {self.whatsapp_cooldown - (current_time - last_whatsapp):.1f} seconds")
                return
            
            camera_name, roi_name = roi_key.split('_', 1)
            
            def send_notification():
                try:
                    result = self.whatsapp.send_video_notification(
                        self.recipient_number,
                        video_path,
                        camera_name,
                        roi_name
                    )
                    if result:
                        print(f"WhatsApp notification sent for {roi_key}")
                        self.roi_last_whatsapp_time[roi_key] = current_time
                    else:
                        print(f"Failed to send WhatsApp notification for {roi_key}")
                except Exception as e:
                    print(f"Error sending WhatsApp notification: {e}")
            
            # Send in background thread
            threading.Thread(target=send_notification, daemon=True).start()
            
        except Exception as e:
            print(f"Error preparing WhatsApp notification for {roi_key}: {e}")

    def _send_whatsapp_notification(self, roi_key):
        """Legacy method - finds most recent video and sends"""
        try:
            current_time = time.time()
            last_whatsapp_time = self.roi_last_whatsapp_time.get(roi_key, 0)
            
            if current_time - last_whatsapp_time < self.whatsapp_cooldown:
                print(f"WhatsApp cooldown active for {roi_key}")
                return
            
            camera_name, roi_name = roi_key.split('_', 1)
            video_files = []

            for filename in os.listdir(self.video_path):
                if filename.startswith(f"{camera_name}_{roi_name}_") and filename.endswith('.mp4'):
                    filepath = os.path.join(self.video_path, filename)
                    video_files.append((filepath, os.path.getmtime(filepath)))
                    
            if video_files:
                most_recent_video = max(video_files, key=lambda x: x[1])[0]
                self._send_whatsapp_notification_for_file(most_recent_video, roi_key)
            else:
                print(f"No video files found for {roi_key}")
                
        except Exception as e:
            print(f"Error in legacy WhatsApp notification: {e}")

    def write_frame_to_active_recordings(self, frame):
        """Write frame to all active recordings"""
        try:
            for roi_key, recording_info in self.active_recordings.items():
                if isinstance(recording_info, dict) and 'writer' in recording_info:
                    video_writer = recording_info['writer']
                    if video_writer.isOpened():
                        video_writer.write(frame)
                elif hasattr(recording_info, 'write'):  # Backward compatibility
                    if recording_info.isOpened():
                        recording_info.write(frame)
        except Exception as e:
            print(f"Error writing frame to recordings: {e}")

    def cleanup_recordings(self):
        """Enhanced cleanup including temp files"""
        try:
            for roi_key in list(self.active_recordings.keys()):
                self._stop_video_recording(roi_key)
            
            for timer in self.recording_timers.values():
                timer.cancel()
            
            self.recording_timers.clear()
            
            # Clean up temp video directory
            try:
                for filename in os.listdir(self.temp_video_dir):
                    if filename.endswith('_temp.avi'):
                        os.remove(os.path.join(self.temp_video_dir, filename))
            except:
                pass
        except Exception as e:
            print(f"Error during cleanup: {e}")

    def get_recording_status(self):
        """Get current recording status"""
        try:
            return {
                'active_recordings': len(self.active_recordings),
                'recording_rois': list(self.active_recordings.keys()),
                'whatsapp_enabled': self.whatsapp_enabled
            }
        except Exception as e:
            print(f"Error getting recording status: {e}")
            return {
                'active_recordings': 0,
                'recording_rois': [],
                'whatsapp_enabled': False
            }

    # Legacy method for backward compatibility
    def _handle_motion_detection(self, frame, roi_name, camera_name):
        """Keep this for backward compatibility, but use the new method"""
        self._handle_motion_detection_with_consistency(frame, roi_name, camera_name)