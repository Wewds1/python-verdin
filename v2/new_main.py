import cv2
from db import get_cameras


def show_all_cameras():
    cameras = get_cameras()
    
    cams = []
    window_names = []
    for cam in cameras:
        cam_id, rtsp_link, name, width, height = cam
        cap = cv2.VideoCapture(rtsp_link)
        
        if not cap.isOpened():
            print(f"Could not open camera {name} with RTSP link {rtsp_link}")
            continue
        cams.append(cap)
        window_names = (name)
        cv2.namedWindow(name, cv2.WINDOW_NORMAL)

    while True:
        for i, cam in enumerate(cams):

            ret, frame = cam.read()
            if not ret:
                print(f"Failed to read frame from camera {window_names[i]}")
                continue
            cv2.imshow(window_names[i], frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    for caps in cams:
        caps.release()
    cv2.destroyAllWindows()
if __name__ == "__main__":
    show_all_cameras()