import json
import os
from pathlib import Path
from config import MOTION_CONFIG, NOTIFICATION_CONFIG

class ConfigManager:
    def __init__(self, config_file="system_config.json"):
        self.config_file = Path(config_file)
        self.load_config()
    
    def load_config(self):
        """Load configuration from file or create defaults"""
        if self.config_file.exists():
            with open(self.config_file, 'r') as f:
                self.config = json.load(f)
            print("Configuration loaded from file")
        else:
            self.config = self.create_default_config()
            self.save_config()
            print("Default configuration created")
    
    def create_default_config(self):
        """Create default system configuration"""
        return {
            "motion_detection": {
                "threshold": 75,
                "min_area": 3000,
                "blur_kernel": 21,
                "cooldown_seconds": 5,
                "use_gaussian_blur": True,
                "use_morphology": True
            },
            "yolo_detection": {
                "enabled": True,
                "model_path": "yolo11n.pt",
                "confidence_threshold": 0.5,
                "classes_to_detect": [0, 1, 2, 3, 5, 7],  # person, bicycle, car, motorcycle, bus, truck
                "overlap_threshold": 0.3
            },
            "notifications": {
                "enabled": True,
                "cooldown_seconds": 30,
                "include_screenshot": True,
                "include_video": False,
                "video_duration": 10
            },
            "system": {
                "view_resolution": [1280, 720],
                "api_port": 5001,
                "api_host": "0.0.0.0",
                "auto_start_api": True,
                "log_level": "INFO"
            },
            "cameras": {}
        }
    
    def save_config(self):
        """Save current configuration to file"""
        with open(self.config_file, 'w') as f:
            json.dump(self.config, f, indent=2)
    
    def get(self, section, key, default=None):
        """Get configuration value"""
        return self.config.get(section, {}).get(key, default)
    
    def set(self, section, key, value):
        """Set configuration value"""
        if section not in self.config:
            self.config[section] = {}
        self.config[section][key] = value
        self.save_config()
    
    def get_motion_config(self):
        """Get motion detection configuration"""
        return self.config.get("motion_detection", {})
    
    def get_yolo_config(self):
        """Get YOLO configuration"""
        return self.config.get("yolo_detection", {})
    
    def update_motion_sensitivity(self, threshold, min_area):
        """Update motion detection sensitivity"""
        self.set("motion_detection", "threshold", threshold)
        self.set("motion_detection", "min_area", min_area)
        return True

# Global config manager instance
config_manager = ConfigManager()