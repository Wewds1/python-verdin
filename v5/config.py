import sqlite3
from dotenv import load_dotenv
import os

load_dotenv()

corner_threshold = 100
snap_distance = 50
server_ip = 'localhost'

class ROI:
    def __init__(self, name, points, roi_id=None):
        self.name = name
        self.points = points
        self.id = roi_id 
    def to_init(self):
        return {'id': self.id, 'name': self.name, 'points': self.points}

class Camera:
    def __init__(self, rtsp_link, camera_name, camera_id, rois):
        self.rtsp_link = rtsp_link
        self.camera_name = camera_name
        self.camera_id = camera_id
        self.rois = rois if rois is not None else []

    @property
    def rtsp_output(self):
        return f"rtsp://{server_ip}:8554/live/{self.camera_name}"

    def add_roi(self, roi):
        self.rois.append(roi)

    def remove_roi(self, roi_id):
        self.rois = [roi for roi in self.rois if roi.id != roi_id]

    def to_dict(self):
        return {
            'rtsp_link': self.rtsp_link,
            'camera_name': self.camera_name,
            'rtsp_output': self.rtsp_output,
            'camera_id': self.camera_id,
            'rois': [roi.to_init() for roi in self.rois]
        }
corner_threshold = 100
snap_distance = 50
server_ip = 'localhost'

# NEW: Motion detection configuration
MOTION_CONFIG = {
    'min_contour_area': 500,  # Minimum area to consider as motion
    'notification_cooldown': 30,  # Seconds between notifications
    'use_yolo_filtering': False,  
    'yolo_filter_classes': [0, 1, 2, 3, 5, 7],  
    'overlap_threshold': 0.3  #
}


videos = [Camera(
    rtsp_link="rtsp://Operator:SmartBox80!@bkdavid.ddns.net:554/streaming/channels/302/",
    camera_name="sample1",
    camera_id="1",
    rois=[]
),
]
 
videos_dict = [cam.to_dict() for cam in videos]

# Webhook Configuration (replaces WhatsApp)
WEBHOOK_URL = os.getenv('WEBHOOK_URL')
WEBHOOK_API_KEY = os.getenv('WEBHOOK_API_KEY')  # Optional, for authentication
WEBHOOK_TIMEOUT = int(os.getenv('WEBHOOK_TIMEOUT', '10'))

NOTIFICATION_CONFIG = {
    'enabled': os.getenv('NOTIFICATION_ENABLED', 'True').lower() == 'true',
    'service': 'webhook',
    'webhook_url': WEBHOOK_URL,
    'api_key': WEBHOOK_API_KEY,
    'timeout': WEBHOOK_TIMEOUT,
    'retry_attempts': 3,
    'retry_delay': 2  # seconds
}