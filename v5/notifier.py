import requests
import logging
import time
import base64
from pathlib import Path
from typing import Optional, Dict, Any
from config import NOTIFICATION_CONFIG

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WebhookNotifier:
    def __init__(self):
        self.enabled = NOTIFICATION_CONFIG.get('enabled', False)
        self.webhook_url = NOTIFICATION_CONFIG.get('webhook_url')
        self.api_key = NOTIFICATION_CONFIG.get('api_key')
        self.timeout = NOTIFICATION_CONFIG.get('timeout', 10)
        self.retry_attempts = NOTIFICATION_CONFIG.get('retry_attempts', 3)
        self.retry_delay = NOTIFICATION_CONFIG.get('retry_delay', 2)
        
        if self.enabled and not self.webhook_url:
            logger.warning("Webhook notifications enabled but no URL configured")
            self.enabled = False

    def send_notification(self, 
                         camera_name: str, 
                         roi_name: str, 
                         screenshot_path: Optional[str] = None,
                         video_path: Optional[str] = None,
                         metadata: Optional[Dict[str, Any]] = None) -> bool:
        """
        Send webhook notification with optional media attachments
        
        Args:
            camera_name: Name of the camera
            roi_name: Name of the ROI where motion detected
            screenshot_path: Path to screenshot file
            video_path: Path to video file
            metadata: Additional metadata to include
        
        Returns:
            bool: True if notification sent successfully
        """
        if not self.enabled:
            logger.debug("Notifications disabled, skipping")
            return False

        payload = {
            'event': 'motion_detected',
            'camera_name': camera_name,
            'roi_name': roi_name,
            'timestamp': time.time(),
            'metadata': metadata or {}
        }

        # Add media as base64 if paths provided
        if screenshot_path and Path(screenshot_path).exists():
            payload['screenshot'] = self._encode_file(screenshot_path)
            payload['screenshot_filename'] = Path(screenshot_path).name
        
        if video_path and Path(video_path).exists():
            payload['video'] = self._encode_file(video_path)
            payload['video_filename'] = Path(video_path).name

        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'CCTV-Motion-Detector/1.0'
        }
        
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'

        # Retry logic
        for attempt in range(self.retry_attempts):
            try:
                response = requests.post(
                    self.webhook_url,
                    json=payload,
                    headers=headers,
                    timeout=self.timeout
                )
                
                if response.status_code in [200, 201, 202, 204]:
                    logger.info(f"Notification sent successfully for {camera_name}/{roi_name}")
                    return True
                else:
                    logger.warning(f"Webhook returned status {response.status_code}: {response.text}")
                    
            except requests.exceptions.Timeout:
                logger.error(f"Webhook request timed out (attempt {attempt + 1}/{self.retry_attempts})")
            except requests.exceptions.RequestException as e:
                logger.error(f"Webhook request failed: {e} (attempt {attempt + 1}/{self.retry_attempts})")
            except Exception as e:
                logger.error(f"Unexpected error sending webhook: {e}")
                break
            
            if attempt < self.retry_attempts - 1:
                time.sleep(self.retry_delay)
        
        return False

    def _encode_file(self, file_path: str) -> str:
        """Encode file to base64 string"""
        try:
            with open(file_path, 'rb') as f:
                return base64.b64encode(f.read()).decode('utf-8')
        except Exception as e:
            logger.error(f"Failed to encode file {file_path}: {e}")
            return ""

    def send_simple_notification(self, message: str, metadata: Optional[Dict] = None) -> bool:
        """Send a simple text notification"""
        if not self.enabled:
            return False

        payload = {
            'event': 'simple_notification',
            'message': message,
            'timestamp': time.time(),
            'metadata': metadata or {}
        }

        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'CCTV-Motion-Detector/1.0'
        }
        
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'

        try:
            response = requests.post(
                self.webhook_url,
                json=payload,
                headers=headers,
                timeout=self.timeout
            )
            
            return response.status_code in [200, 201, 202, 204]
            
        except Exception as e:
            logger.error(f"Failed to send simple notification: {e}")
            return False