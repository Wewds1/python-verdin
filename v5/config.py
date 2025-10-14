import sqlite3

corner_threshold = 100
snap_distance = 50
server_ip = 'localhost'

class ROI:
    def __init__(self, name, points, roi_id=None):
        self.name = name
        self.points = points
        self.id = roi_id  # Store ROI ID for database reference

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


WHATSAPP_CONFIG = {
    'enabled': True,
    'access_token': 'EAAJ1Mph6nNkBPCvBOZB5taEYzbSt0nQbCp69ctAAstMXXXroxZAJwWsIaBTUXtnwrJcpFDT7ONkKJ6gqxUHLPYVVP5iFk9SsZAQscbOxF8wPtvZATn3TYtCpei388XvB5jd44BZAyd8NMe8ulyDtaLUX4S44J3qnlAfriGXa9TRgtqRUhfDNnzr2EZAed97wZDZD',
    'phone_number_id': '635876812952923',
    'recipient_number': '639763583028'
}