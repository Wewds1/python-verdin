import cv2
import subprocess
import threading
import imutils
import math
import sys
import numpy as np
from config import videos, corner_threshold, snap_distance, server_ip, Camera
from utils import add_roi, get_camera, create_tables, add_camera, update_roi, delete_roi, delete_camera, get_rois


def subtract_images(image1, image2):
    diff = cv2.absdiff(image1, image2)
    _, thresh = cv2.threshold(diff, 50, 255, cv2.THRESH_BINARY)
    return diff, thresh


def get_camera_dbid(camera_name):
    for cam in get_camera():
        if cam[1] == camera_name:
            return cam[0]
        
    return None


def register_camera(camera_name, rtsp_link):
    for cam in get_camera():
        if cam[1] == camera_name:
            return cam[0], cam[4]
    rtsp_output = f"rtsp://{server_ip}:8554/live/{camera_name}"
    camera_id = add_camera(camera_name, rtsp_link, None, rtsp_output)
    return camera_id, rtsp_output


def video_process(video):
    camera_id = get_camera_dbid(video.camera_name)
    rois = get_rois(camera_id) if camera_id is not None else []
    video_cap = cv2.VideoCapture(video.rtsp_link, cv2.CAP_FFMPEG)
    if not video_cap.isOpened():
        print(f"Error opening video stream: {video.rtsp_link}")
        return
    edit_mode = False
    selected_roi_idx = None
    background_frame = None
    current_points = []
    selected_points = None
    window_name = f"Motion Detection - {video.camera_name}"

    ffmpeg_cmd = [
        'ffmpeg',
        '-y',
        '-f', 'rawvideo',
        '-pixel_format', 'bgr24',
        '-video_size', '1280x720',
        '-framerate', '25',
        '-i', '-',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-f', 'rtsp',
        f'rtsp://{server_ip}:8554/live/{video.camera_name}'
    ]
    ffmpeg = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)
    def point_in_roi(point, shape):
        pts = np.array(shape, dtype=np.int32)
        return cv2.pointPolygonTest(pts, point, False) >= 0
    def mouse_callback(event, x, y, flags, param):
        nonlocal current_points, selected_points, edit_mode, selected_roi_idx
        h, w = param['shape']
        corners = [(0, 0), (w-1, 0), (w-1, h-1), (0, h-1)]
        if event == cv2.EVENT_LBUTTONDOWN:
            for cx, cy in corners:
                if abs(x - cx) < snap_distance and abs(y - cy) < snap_distance:
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
            current_points = []
            
        if edit_mode and event == cv2.EVENT_MOUSEMOVE:
            for idx, roi in enumerate(rois):
                if point_in_roi((x, y), roi['points']):
                    selected_roi_idx = idx
                    current_points = roi['points'].copy()
                    break

    cv2.namedWindow(window_name)
    param = {'shape': (720, 1280)}
    cv2.setMouseCallback(window_name, mouse_callback, param)

    rois = [roi.to_init() if hasattr(roi, 'to_init') else roi for roi in video.rois]

    while True:
        success, frame = video_cap.read()
        if not success:
            break

        frame = cv2.resize(frame, (1280, 720))
        h, w = frame.shape[:2]
        param['shape'] = (h, w)
        corners = [(0, 0), (w-1, 0), (w-1, h-1), (0, h-1)]

        for pt in current_points:
            cv2.circle(frame, pt, 5, (0, 255, 255), -1)
        if len(current_points) > 1:
            cv2.polylines(frame, [np.array(current_points)], False, (0, 255, 0), 1)

        gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if background_frame is None:
            background_frame = gray_frame
            continue

        for roi in rois:
            if 'points' in roi:
                pts = np.array(roi['points'], dtype=np.int32)
                name = roi['name']
            else:
                continue
            cv2.polylines(frame, [pts], isClosed=True, color=(255, 0, 0), thickness=2)

            mask = np.zeros_like(gray_frame)
            cv2.fillPoly(mask, [pts], 255)
            roi_gray = cv2.bitwise_and(gray_frame, mask)
            roi_background = cv2.bitwise_and(background_frame, mask)
            diff, thresh = subtract_images(roi_background, roi_gray)
            if thresh is None or thresh.size == 0:
                continue
            dilated_image = cv2.dilate(thresh, None, iterations=2)
            cnts = cv2.findContours(dilated_image.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cnts = imutils.grab_contours(cnts)
            for c in cnts:
                if cv2.contourArea(c) < 3000:
                    continue
                x, y, w, h = cv2.boundingRect(c)
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                cv2.putText(frame, name, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        if ffmpeg.poll() is not None:
            print(f"⚠️ FFmpeg process has exited for {video.camera_name}. Stopping...")
            break

        try:
            ffmpeg.stdin.write(frame.tobytes())
        except BrokenPipeError:
            print(f"⚠️ Broken pipe for {video.camera_name}. FFmpeg may have crashed.")
            break

        key = cv2.waitKey(1)
        if not edit_mode and key == 13 and len(current_points) > 2:
            for cx, cy in corners:
                first_dist = math.hypot(current_points[0][0] - cx, current_points[0][1] - cy)
                last_dist = math.hypot(current_points[-1][0] - cx, current_points[-1][1] - cy)
                if first_dist < corner_threshold and last_dist < corner_threshold:
                    current_points.append((cx, cy))
                    selected_points = None
                    break
            camera_id = get_camera_dbid(video.camera_name)
            new_roi={'points': current_points.copy(), 'name': f'ROI_{len(rois)+1}'}
            rois.append(new_roi)
            if camera_id is not None:
                add_roi(camera_id, new_roi['name'],new_roi['points'])
                rois = get_rois(camera_id)

            current_points.clear()

        if key & 0xFF == ord('e'):
            if rois:
                edit_mode = True
                selected_roi_idx = 0
                current_points = rois[selected_roi_idx]['points'].copy()

        if edit_mode and key == 13 and len(current_points) > 2:
            rois[selected_roi_idx]['points'] = current_points.copy()
            camera_id = get_camera_dbid(video.camera_name)
            roi_name = rois[selected_roi_idx]['name']
            roi_id = rois[selected_roi_idx].get('id', None)
            if camera_id is not None and roi_id is not None:
                update_roi(camera_id, roi_name, current_points.copy())
            edit_mode = False
            background_frame = None
            selected_roi_idx = None
            current_points.clear()
            print("ROI updated!")
        
        if edit_mode and key & 0xFF == ord('d'):
            roi_id = rois[selected_roi_idx].get('id', None)
            if roi_id is not None:
                delete_roi(roi_id)
                camera_id = get_camera_dbid(video.camera_name)
                rois = get_rois(camera_id)
                selected_roi_idx = None
                edit_mode = False
                current_points.clear()
                print("ROI deleted!")


        if key & 0xFF == ord('q'):
            break
        
      
        cv2.imshow(window_name, frame)

    video_cap.release()
    cv2.destroyWindow(window_name)
    ffmpeg.stdin.close()
    ffmpeg.wait()
    print(f"FFmpeg exited for {video.camera_name}")

# Run each camera in a thread
if __name__ == "__main__":
    create_tables()
    if len(sys.argv) >= 3:
        rtsp_link = sys.argv[1]
        camera_name = sys.argv[2]
        camera_id, rtsp_output = register_camera(camera_name, rtsp_link)
        video = Camera(rtsp_link, camera_name , camera_id, rois=[])
        print(f"RTSP OUTPUT for: {camera_name} is {rtsp_output}")
        video.rtsp_link = rtsp_link
        video.camera_name = camera_name
        video.rois = []
        video_process(video)
    else:
        threads = []
        for video in videos:
            t = threading.Thread(target=video_process, args=(video,), daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()

