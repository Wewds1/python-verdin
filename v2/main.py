import cv2
import imutils
import subprocess
import requests
import threading
import sqlite3
import time

from db import get_cameras, get_rois

# --- Load camera data from database ---
cameras = get_cameras()


def register_mtx_path(server_ip, path_name):
    api_url = f'http://{server_ip}:9997/v3/config/paths/add/{path_name}'
    try:
        res = requests.post(api_url, json={
            'source': 'publisher',
            'sourceProtocol': 'rtmp',
        })
        if res.status_code != 200:
            print(f"Failed to register path: {res.status_code} - {res.text}")
    except Exception as e:
        print(f'Error registering path: {e}')

def subtract_images(image1, image2):
    diff = cv2.absdiff(image1, image2)
    _, thresh = cv2.threshold(diff, 50, 255, cv2.THRESH_BINARY)
    return diff, thresh

def process_camera(camera):
    rois = get_cameras(camera['id'])

    cap = cv2.VideoCapture(camera['rtsp_link'], cv2.CAP_FFMPEG)
    if not cap.isOpened():
        print(f"[ERROR] Could not open RTSP stream for {camera['name']}")
        return

    background_frame = None
    window_name = camera['name']
    rtmp_path = camera['rtmp_link'].split('/')[-1]
    server_ip = camera['rtmp_link'].split('/')[2].split(':')[0]

    register_mtx_path(server_ip, rtmp_path)

    ffmpeg_cmd = [
        'ffmpeg', '-y',
        '-f', 'rawvideo',
        '-pixel_format', 'bgr24',
        '-video_size', '1280x720',
        '-framerate', '25',
        '-i', '-',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-f', 'flv',
        camera['rtmp_link']
    ]

    ffmpeg = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

    while True:
        success, frame = cap.read()
        if not success:
            print(f"[WARN] Failed to read frame from {camera['name']}")
            time.sleep(1)
            continue

        frame = cv2.resize(frame, (1280, 720))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        if background_frame is None:
            background_frame = gray
            continue

        for roi in rois:
            x, y, w, h = roi['x'], roi['y'], roi['w'], roi['h']
            name = roi['name']
            if w == 0 or h == 0:
                continue

            roi_gray = gray[y:y+h, x:x+w]
            roi_bg = background_frame[y:y+h, x:x+w]
            _, thresh = subtract_images(roi_bg, roi_gray)

            dilated = cv2.dilate(thresh, None, iterations=2)
            cnts = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cnts = imutils.grab_contours(cnts)

            for c in cnts:
                if cv2.contourArea(c) < 3000:
                    continue
                (rx, ry, rw, rh) = cv2.boundingRect(c)
                cv2.rectangle(frame, (x + rx, y + ry), (x + rx + rw, y + ry + rh), (0, 255, 0), 2)
                cv2.putText(frame, name, (x + rx, y + ry - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 1)

        cv2.imshow(window_name, frame)

        if ffmpeg.poll() is not None:
            print(f"[ERROR] FFmpeg crashed for {camera['name']}")
            break

        try:
            ffmpeg.stdin.write(frame.tobytes())
        except BrokenPipeError:
            print(f"[ERROR] Broken pipe for {camera['name']}")
            break

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    ffmpeg.stdin.close()
    ffmpeg.wait()
    cv2.destroyWindow(window_name)

# --- Launch threads ---
for cam in cameras:
    threading.Thread(target=process_camera, args=(cam,), daemon=True).start()

# Keep main thread alive
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("[INFO] Exiting...")
    cv2.destroyAllWindows()
