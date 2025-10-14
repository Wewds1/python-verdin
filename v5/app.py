import cv2
import sys
import math
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
        
        video_cap = cv2.VideoCapture(video.rtsp_link, cv2.CAP_FFMPEG)
        video_cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        if not video_cap.isOpened():
            return

        # Initialize components
        ffmpeg = self.streaming_manager.start_ffmpeg(video.rtsp_output)
        if ffmpeg is None:
            return
            
        gpu_initialized, gpu_objects = self.motion_detector.initialize_gpu_memory()
        
        # State variables
        edit_mode = False
        selected_roi_idx = None
        background_frame = None
        background_set = False
        current_points = []
        selected_points = None
        window_name = f"Motion Detection - {video.camera_name}"
        
        # Setup UI
        cv2.namedWindow(window_name)
        param = {'shape': (720, 1280)}
        mouse_callback = self.roi_manager.create_mouse_callback(
            current_points, selected_points, edit_mode, selected_roi_idx, video.rois
        )
        cv2.setMouseCallback(window_name, mouse_callback, param)
        
        # Main processing loop
        while True:
            success, frame = video_cap.read()
            if not success or frame is None or frame.shape[0] == 0:
                continue

            frame = cv2.resize(frame, (1280, 720))
            param['shape'] = frame.shape[:2]
            corners = [(0, 0), (frame.shape[1]-1, 0), (frame.shape[1]-1, frame.shape[0]-1), (0, frame.shape[0]-1)]

            # YOLO detection
            yolo_detections = self.yolo_detector.detect(frame)
            self.yolo_detector.draw_detections(frame, yolo_detections)

            # ROI visualization
            self.roi_manager.draw_roi_points(frame, current_points)

            # Motion detection
            if gpu_initialized:
                background_set, motion_detections = self.motion_detector.process_cuda_motion(
                    frame, video.rois, gpu_objects, background_set, video.camera_name
                )
            else:
                background_frame, motion_detections = self.motion_detector.process_cpu_motion(
                    frame, video.rois, background_frame, video.camera_name
                )
            
            self.roi_manager.draw_motion_detections(frame, motion_detections)

            # Streaming
            ffmpeg = self.streaming_manager.write_frame(ffmpeg, frame, video.rtsp_output)
            if ffmpeg is None:
                break

            # Handle keyboard input
            if self._handle_keyboard_input(cv2.waitKey(1), edit_mode, selected_roi_idx, 
                                         current_points, corners, camera_id, video, 
                                         gpu_initialized, background_set, background_frame):
                break

            cv2.imshow(window_name, frame)

        # Cleanup
        self._cleanup(video_cap, window_name, ffmpeg)
    
    def _handle_keyboard_input(self, key, edit_mode, selected_roi_idx, current_points, 
                             corners, camera_id, video, gpu_initialized, background_set, background_frame):
        # Add ROI
        if not edit_mode and key == 13 and len(current_points) > 2:
            self._add_roi(current_points, corners, camera_id, video, gpu_initialized, background_set, background_frame)
        
        # Edit mode toggle
        elif key & 0xFF == ord('e') and video.rois:
            edit_mode = True
            selected_roi_idx = 0
            current_points.clear()
            current_points.extend(video.rois[selected_roi_idx].points.copy())
        
        # Update ROI
        elif edit_mode and key == 13 and len(current_points) > 2:
            self._update_roi(selected_roi_idx, current_points, video, gpu_initialized, background_set, background_frame)
            edit_mode = False
        
        # Delete ROI
        elif edit_mode and key & 0xFF == ord('d') and selected_roi_idx is not None:
            self._delete_roi(selected_roi_idx, video)
            edit_mode = False
        
        # Quit
        elif key & 0xFF == ord('q'):
            return True
            
        return False
    
    def _add_roi(self, current_points, corners, camera_id, video, gpu_initialized, background_set, background_frame):
        for cx, cy in corners:
            first_dist = math.hypot(current_points[0][0] - cx, current_points[0][1] - cy)
            last_dist = math.hypot(current_points[-1][0] - cx, current_points[-1][1] - cy)
            if first_dist < corner_threshold and last_dist < corner_threshold:
                current_points.append((cx, cy))
                break

        roi_name = self.roi_manager.get_roi_name(len(video.rois) + 1)
        roi_id = add_roi(camera_id, roi_name, current_points)
        if roi_id:
            video.add_roi(ROI(roi_name, current_points.copy(), roi_id))
            current_points.clear()
            if gpu_initialized:
                background_set = False
            else:
                background_frame = None
    
    def _update_roi(self, selected_roi_idx, current_points, video, gpu_initialized, background_set, background_frame):
        if selected_roi_idx is not None:
            roi = video.rois[selected_roi_idx]
            success = update_roi(roi.id, roi.name, current_points)
            if success:
                roi.points = current_points.copy()
            current_points.clear()
            if gpu_initialized:
                background_set = False
            else:
                background_frame = None
    
    def _delete_roi(self, selected_roi_idx, video):
        roi = video.rois[selected_roi_idx]
        success = delete_roi(roi.id)
        if success:
            video.remove_roi(roi.id)
    
    def _cleanup(self, video_cap, window_name, ffmpeg):
        self.motion_detector.cleanup_recordings()
        video_cap.release()
        cv2.destroyWindow(window_name)
        try:
            ffmpeg.stdin.close()
        except:
            pass
        ffmpeg.wait()

# Main execution
if __name__ == "__main__":
    processor = CameraProcessor()
    create_tables()
    
    if len(sys.argv) >= 3:
        rtsp_link = sys.argv[1]
        camera_name = sys.argv[2]
        camera_id, rtsp_output = processor.register_camera(camera_name, rtsp_link)
        video = Camera(rtsp_link, camera_name, camera_id, rois=[])
        processor.process_video(video)
    else:
        import threading
        threads = []
        for video in videos:
            t = threading.Thread(target=processor.process_video, args=(video,), daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()