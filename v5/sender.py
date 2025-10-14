import requests
import json
import os
import time
from datetime import datetime, timedelta

class WhatsAppNotifier:
    def __init__(self, access_token, phone_number_id):
        self.access_token = access_token
        self.phone_number_id = phone_number_id
        self.base_url = f"https://graph.facebook.com/v18.0/{phone_number_id}/messages"
        self.media_url = f"https://graph.facebook.com/v18.0/{phone_number_id}/media"
        self.headers = {
            "Authorization": f"Bearer {access_token}"
        }
        self.last_notification_time = None
        self.cooldown_seconds = 10  # 10 seconds cooldown
    
    def can_send_notification(self):
        """Check if enough time has passed since last notification"""
        if self.last_notification_time is None:
            return True
        
        time_since_last = datetime.now() - self.last_notification_time
        return time_since_last.total_seconds() >= self.cooldown_seconds
    
    def upload_video(self, video_file_path):
        """Upload video file to WhatsApp servers with validation"""
        if not os.path.exists(video_file_path):
            print(f"Video file not found: {video_file_path}")
            return None
        
        # Check file size (WhatsApp has a 16MB limit for videos)
        file_size = os.path.getsize(video_file_path)
        if file_size > 16 * 1024 * 1024:  # 16MB
            print(f"Video file too large: {file_size / (1024*1024):.2f}MB. WhatsApp limit is 16MB.")
            return None
        
        try:
            with open(video_file_path, 'rb') as video_file:
                files = {
                    'file': ('video.mp4', video_file, 'video/mp4'),
                    'messaging_product': (None, 'whatsapp'),
                    'type': (None, 'video')
                }
                
                response = requests.post(
                    self.media_url,
                    headers={"Authorization": f"Bearer {self.access_token}"},
                    files=files,
                    timeout=60  # Add timeout
                )
                
                if response.status_code == 200:
                    media_data = response.json()
                    media_id = media_data.get('id')
                    print(f"Video uploaded successfully! Media ID: {media_id}")
                    return media_id
                else:
                    print(f"Error uploading video: {response.status_code}")
                    print(f"Response: {response.text}")
                    return None
                    
        except Exception as e:
            print(f"Exception occurred while uploading: {str(e)}")
            return None
    
    def send_video_notification(self, recipient_number, video_file_path, camera_name, roi_name):
        """Send video notification with cooldown check"""
        
        # Check cooldown
        if not self.can_send_notification():
            remaining_time = self.cooldown_seconds - (datetime.now() - self.last_notification_time).total_seconds()
            print(f"Cooldown active. Wait {remaining_time:.1f} more seconds before sending next notification.")
            return None
        
        # Upload and send video
        media_id = self.upload_video(video_file_path)
        if not media_id:
            print("Failed to upload video. Cannot send message.")
            return None
        
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient_number,
            "type": "template",
            "template": {
                "name": "lintel",
                "language": {
                    "code": "en"
                },
                "components": [
                    {
                        "type": "header",
                        "parameters": [
                            {
                                "type": "video",
                                "video": {
                                    "id": media_id
                                }
                            }
                        ]
                    },
                    {
                        "type": "body",
                        "parameters": [
                            {
                                "type": "text",
                                "text": str(camera_name)
                            },
                            {
                                "type": "text",
                                "text": f"Motion in {roi_name}"
                            }
                        ]
                    }
                ]
            }
        }
        
        try:
            headers_with_content_type = self.headers.copy()
            headers_with_content_type["Content-Type"] = "application/json"
            
            response = requests.post(
                self.base_url,
                headers=headers_with_content_type,
                data=json.dumps(payload),
                timeout=30
            )
            
            if response.status_code == 200:
                print("Video notification sent successfully!")
                self.last_notification_time = datetime.now()
                return response.json()
            else:
                print(f"Error sending message: {response.status_code}")
                print(f"Response: {response.text}")
                return None
                
        except Exception as e:
            print(f"Exception occurred: {str(e)}")
            return None