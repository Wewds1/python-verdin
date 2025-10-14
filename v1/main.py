from config import RTSP_URL, RTMP_URL, CONTOUR_THRESHOLD, MARGIN, BOX_LIFETIME
from utils import (
    init_video_capture,
    init_ffmpeg,
    preprocess_frame,
    detect_motion,
    get_contours,
    iou,
    merge_boxes,
    draw_boxes,
    update_box_memory,
    stream_frame
)

import cv2


def main():
    video = init_video_capture(RTSP_URL)
    width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = video.get(cv2.CAP_PROP_FPS)   
    if fps == 0 or fps is None:
        fps = 30
    ffmpeg= init_ffmpeg(width, height, fps, RTMP_URL)

    prev_gray = None
    box_memory = []

    cv2.namedWindow("Sample Window", cv2.WINDOW_NORMAL)

    while True:

        ret, frame = video.read()

        if not ret:
            print("Error reading frame exiting....")
            break


        gray = preprocess_frame(frame)
        if prev_gray is None:
            prev_gray = gray
            continue

        thresh,_ = detect_motion(prev_gray, gray)
        contours = get_contours(thresh, CONTOUR_THRESHOLD)
        boxes = [cv2.boundingRect(c) for c in contours]
        merged = merge_boxes(boxes, iou_threshold=0.1)
        box_memory = update_box_memory(merged, box_memory, BOX_LIFETIME)
        draw_boxes(frame, box_memory, MARGIN, width, height)
        stream_frame(frame, ffmpeg)


        prev_gray = gray
        cv2.imshow("Sample Window", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    
    video.release()
    cv2.destroyAllWindows()
    ffmpeg.stdin.close()

if __name__ == "__main__":
    main()