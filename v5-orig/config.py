import sqlite3
from dotenv import load_dotenv
import os

corner_threshold = 100
snap_distance = 50
server_ip = '10.10.10.66'

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

videos = [Camera(
    rtsp_link="rtsp://admin:c0smeti123@10.10.10.98:554/cam/realmonitor?channel=6&subtype=0&unicast=true&proto=Onvif",
    camera_name="sample1",
    camera_id="1",
    rois=[]
),
]

videos_dict = [cam.to_dict() for cam in videos]

WHATSAPP_API = os.getenv('WHATSAPP_API')
WHATSAPP_PHONE_NUMBER_ID = os.getenv('WHATSAPP_PHONE_NUMBER_ID')
WHATSAPP_RECIPIENT_NUMBER = os.getenv('WHATSAPP_RECIPIENT_NUMBER')



WHATSAPP_CONFIG = {
    'enabled': True,
    'access_token': WHATSAPP_API,
    'phone_number_id': WHATSAPP_PHONE_NUMBER_ID,
    'recipient_number': WHATSAPP_RECIPIENT_NUMBER
}