import cv2
import imutils
import subprocess
import random
import requests
import sqlite3
import math

import numpy as np



video_path = 'rtsp://admin:c0smeti123@10.10.10.98:554/cam/realmonitor?channel=8&subtype=0&unicast=true&proto=Onvif'
video_cap = cv2.VideoCapture(video_path, cv2.CAP_FFMPEG)
background_frame = None
motion_detected = False
drawing = False
ix, iy = -1, -1
roi_name = ''
current_rect = None
current_points = []
selected_points = None
snap_distance = 50
corner_threshold = 100
rois = []



    
server_ip = '10.10.10.66'
paths = 'officemaster1'



def register_mtx_path(server_ip, path_name):
    api_url = f'http://{server_ip}:9997/v3/config/paths/add/{path_name}'
    try: 
        res = requests.post(api_url, json={
            'source': 'publisher',
            'sourceProtocol': 'rtsp',
        })
        if res.status_code != 200:
            print(f"Failed to register path: {res.status_code} - {res.text}")
    except Exception as e:
        print(f'Error registering path: {e}')
register_mtx_path(server_ip, paths)

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
    f'rtsp://{server_ip}:8554/live/{paths}' 
 
]
ffmpeg = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)


def mouse_callback(event, x, y, flags, param):
    global current_points, drawing, selected_points
    if event == cv2.EVENT_LBUTTONDOWN:
        # Snap to corners if close
        for cx, cy in corners:
            if abs(x - cx) < snap_distance and abs(y - cy) < snap_distance:
                current_points.append((cx, cy))
                selected_points = None
                return
        # Snap to sides if close (top, bottom, left, right)
        if abs(y) < snap_distance:
            current_points.append((x, 0))
            selected_points = None
            return
        if abs(y - (h-1)) < snap_distance:
            current_points.append((x, h-1))
            selected_points = None
            return
        if abs(x) < snap_distance:
            current_points.append((0, y))
            selected_points = None
            return
        if abs(x - (w-1)) < snap_distance:
            current_points.append((w-1, y))
            selected_points = None
            return
        for idx, point in enumerate(current_points):
            if abs(point[0] - x) < 10 and abs(point[1] - y) < 10:
                selected_points = idx
                drawing = True
                return
        current_points.append((x,y))
        selected_points = None
    elif event == cv2.EVENT_MOUSEMOVE and selected_points is not None:
        current_points[selected_points] = (x,y)
    
    elif event == cv2.EVENT_LBUTTONUP:
        selected_points = None

    elif event == cv2.EVENT_RBUTTONDOWN:
        current_points = []

def draw_points(frame):
    for pt in current_points:
        cv2.circle(frame, pt, 5, (0, 255, 255), -1)
    if len(current_points) > 1:
        cv2.polylines(frame, [np.array(current_points)], False, (0, 255, 0), 1)
    for roi in rois:
        pts = roi['points']
        cv2.polylines(frame, [np.array(pts)], True, (255,0,0),1)
        for pt in pts:
            cv2.circle(frame, pt, 5, (255, 0, 0), -1)


def random_color():
    return (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))

def draw_roi(event, x, y, flags, param):

    global rois, drawing, frame, ix, iy, roi_name, current_rect

    if event == cv2.EVENT_LBUTTONDOWN:
        drawing = True
        ix, iy = x, y
        current_rect = None

    elif event == cv2.EVENT_MOUSEMOVE:
        if drawing:
            x0 , y0 = min(ix, x), min(iy, y)
            w, h = abs(x - ix), abs(y - iy)
            current_rect  = (x0,y0,w,h)

    elif event == cv2.EVENT_LBUTTONUP:

        drawing = False
        w, h = abs(x - ix), abs(y - iy)
        x0, y0 = min(ix, x), min(iy, y)
        roi_name = f"ROI_{len(rois)+1}"
        rois.append({'x': x0, 'y': y0, 'w': w, 'h': h, 'name':roi_name})
        cv2.rectangle(frame, (x0, y0), (x0 + w, y0 + h), (255, 0, 0), 2)
        cv2.putText(frame, roi_name, (x0, y0 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.2, (255, 0, 0), 2)


def subtract_images(image1, image2):
    diff = cv2.absdiff(image1, image2)
    _, thresh = cv2.threshold(diff, 50, 255, cv2.THRESH_BINARY)
    return diff, thresh


cv2.namedWindow("Motion Detection")
cv2.setMouseCallback("Motion Detection", mouse_callback)

while True:
    success, frame = video_cap.read()
    if not success:
        break
    frame = cv2.resize(frame, (1280, 720))
    h,w = frame.shape[:2]
    draw_points(frame)
    corners = ((0,0), (0,h-1), (w-1, h-1), (w-1, 0))
    gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    if background_frame is None:
        background_frame = gray_frame
        continue

    frame_h, frame_w = gray_frame.shape
    for roi in rois:
        if 'points' in roi:
            pts = np.array(roi['points'], dtype=np.int32)
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
                (x, y, w, h) = cv2.boundingRect(c)
 
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                cv2.putText(frame, roi['name'], (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        
    if current_rect is not None:
        x0, y0, w, h = current_rect
        cv2.rectangle(frame, (x0,y0), (x0 + w, y0 + h), (0, 255, 255), 1)

    cv2.imshow("Motion Detection", frame)
    if ffmpeg.poll() is not None:
        print("⚠️ FFmpeg process has exited. Stopping...")
        break

    try:
        ffmpeg.stdin.write(frame.tobytes())
    except BrokenPipeError:
        print("⚠️ Broken pipe. FFmpeg may have crashed.")
        break
    ffmpeg.stdin.write(frame.tobytes())
    key = cv2.waitKey(1)
    if key == 13:  # Enter key
        if len(current_points) > 2:
            for cx, cy in corners:
                first_dist = math.hypot(current_points[0][0] - cx, current_points[0][1] - cy)
                last_dist = math.hypot(current_points[-1][0] - cx, current_points[-1][1] - cy)

                if first_dist < corner_threshold and last_dist < corner_threshold:
                    current_points.append((cx, cy))
                    selected_points = None  # Reset state if needed
                    break

            rois.append({'points': current_points.copy(), 'name': f'ROI_{len(rois)+1}'})
            current_points.clear()
    if key & 0xFF == ord('q'):
        break
# if current_points[0][0] > current_points[-1][0] and current_points[0][1] > current_points[-1][1]:
#     current_points.append((0,w-1))
# elif current_points[0][0] < current_points[-1][0] and current_points[0][1] < current_points[-1][1]:
#     current_points.append((w-1,0))
# elif current_points[0][0] < current_points[-1][0] and current_points[0][1] > current_points[-1][1]:
#     current_points.append((w-1, h-1))
# elif current_points[0][0] > current_points[-1][0] and current_points[0][1] < current_points[-1][1]:
#     current_points.append((0, h-1))


# for cx, cy in corners:
#     first = abs(current_points[0][0] - cx) and (abs(current_points[0][1] - cy))
#     last = abs(current_points[-1][0] - cx ) and (abs(current_points[-1][1] - cy))
#     if first < 100 and last < 100:
#         current_points.append((cx, cy))
#         selected_points = None
#         break



video_cap.release()
cv2.destroyAllWindows()
ffmpeg.stdin.close()
ffmpeg.wait()
return_code = ffmpeg.wait()
print(f"FFmpeg exited with code: {return_code}")
