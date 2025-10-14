from config import RTSP_URL, RTMP_URL, CONTOUR_THRESHOLD, MARGIN, BOX_LIFETIME
import cv2
import subprocess

def init_video_capture(rtsp_url):
    return cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

def init_ffmpeg(width, height, fps, rtmp_url):
    ffmpeg_command = [
        'ffmpeg',
        '-y',
        '-f', 'rawvideo',
        '-pixel_format', 'bgr24',
        '-vcodec', 'rawvideo',
        '-s', f'{int(width)}x{int(height)}',
        '-r', str(fps),
        '-i', '-',  # Input from stdin
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-f', 'flv',
        rtmp_url
    ]
    return subprocess.Popen(ffmpeg_command, stdin=subprocess.PIPE)

def preprocess_frame(frame):
  gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
  gray = cv2.GaussianBlur(gray, (21,21), 0)
  return gray

def detect_motion(prev_gray, gray):
    frame_delta = cv2.absdiff(prev_gray, gray)
    thresh = cv2.threshold(frame_delta, 25, 255, cv2.THRESH_BINARY)[1]
    thresh = cv2.dilate(thresh, None, iterations=2)
    return frame_delta, thresh

def get_contours(thresh, contour_threshold):
    contours, _ = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filtered = [cnt for cnt in contours if cv2.contourArea(cnt) >= contour_threshold]

    return filtered

def iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])

    innerWidth = max(0, xB - xA)
    innerHeight = max(0, yB - yA)
    intersection = innerWidth * innerHeight

    boxAArea = boxA[2] * boxA[3]
    boxBArea = boxB[2] * boxB[3]

    iou_value = intersection / float(boxAArea + boxBArea - intersection + 1e-5)

    return iou_value

def merge_boxes(boxes, iou_threshold=0.1):
    merged_boxes = []
    used = [False] * len(boxes)

    for i in range(len(boxes)):
        if used[i]:
            continue
        (x1, y1, w1, h1) = boxes[i]
        x2 = x1 + w1
        y2 = y1 + h1

        for j in range(i + 1, len(boxes)):
            if used[j]:
                continue
            if iou(boxes[i], boxes[j]) > iou_threshold:
                (nx, ny, nw, nh) = boxes[j]
                nx2 = nx + nw
                ny2 = ny + nh
                x1 = min(x1, nx)
                y1 = min(y1, ny)
                x2 = max(x2,nx2)
                y2 = max(y2,ny2)
                used[j] = True
        merged_boxes.append((x1,y1,x2-x1,y2-y1))
        used[i] = True
    return merged_boxes

def update_box_memory(merged_boxes, box_memory, box_lifetime):
    new_memory = []
    for box in merged_boxes:
        found = False
        for bm in box_memory:
            # Simple overlap check (you can use iou for more accuracy)
            if abs(box[0] - bm[0]) < 50 and abs(box[1] - bm[1]) < 50:
                new_memory.append([*box, box_lifetime])
                found = True
                break
        if not found:
            new_memory.append([*box, box_lifetime])
    for bm in box_memory:
        if not any(abs(bm[0] - box[0]) < 50 and abs(bm[1] - box[1]) < 50 for box in merged_boxes):
            if bm[4] > 0:
                new_memory.append([*bm[:4], bm[4] - 1])
    return [bm for bm in new_memory if bm[4] > 0]

def draw_boxes(frame, box_memory, margin, width, height):
    for (x, y, w, h, frames_left) in box_memory:
        x1 = max(0, x - margin)
        y1 = max(0, y - margin)
        x2 = min(width, x + w + margin)
        y2 = min(height, y + h + margin)
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)

        
def stream_frame(frame, ffmpeg):
    ffmpeg.stdin.write(frame.tobytes())