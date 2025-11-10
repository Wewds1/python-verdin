#!/usr/bin/env python3
"""
Production startup script for CCTV System
Handles initialization, monitoring, and graceful shutdown
"""

import signal
import sys
import time
import atexit
from pathlib import Path

# Import your modules
from app import CameraProcessor
from control_api import start_api
from system_monitor import system_monitor
from config_manager import config_manager
from init_database import initialize_system_database

class ProductionCCTVSystem:
    def __init__(self):
        self.processor = None
        self.api_thread = None
        self.running = False
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        atexit.register(self.shutdown)
    
    def start(self):
        """Start the complete CCTV system"""
        print("Starting Production CCTV System")
        print("=" * 50)
        
        try:
            # 1. Initialize database
            print("Initializing database...")
            initialize_system_database()
            
            # 2. Start system monitoring
            print("Starting system monitor...")
            system_monitor.start_monitoring()
            
            # 3. Initialize camera processor
            print("Initializing camera processor...")
            self.processor = CameraProcessor()
            
            # Apply configuration
            motion_config = config_manager.get_motion_config()
            self.processor.motion_threshold = motion_config.get('threshold', 75)
            
            yolo_config = config_manager.get_yolo_config()
            self.processor.use_yolo_filtering = yolo_config.get('enabled', True)
            
            # 4. Start API server
            system_config = config_manager.config.get('system', {})
            api_host = system_config.get('api_host', '0.0.0.0')
            api_port = system_config.get('api_port', 5001)
            
            if system_config.get('auto_start_api', True):
                print(f"🌐 Starting API server on {api_host}:{api_port}...")
                self.api_thread = start_api(self.processor, api_host, api_port)
            
            # 5. Start main processing
            print("Starting camera processing...")
            self.running = True
            self.processor.run()
            
            print("CCTV System started successfully!")
            print("Control API available at: http://localhost:5001")
            print("Dashboard available at: http://localhost:8080/dashboard.html")
            print("Press Ctrl+C to stop")
            
            # Keep main thread alive
            while self.running:
                time.sleep(1)
                
        except KeyboardInterrupt:
            print("\nShutdown requested by user")
        except Exception as e:
            print(f"Fatal error: {e}")
            system_monitor.log_error(str(e))
        finally:
            self.shutdown()
    
    def shutdown(self):
        """Graceful shutdown"""
        if not self.running:
            return
            
        print("\nShutting down CCTV System...")
        self.running = False
        
        try:
            # Stop camera processor
            if self.processor:
                self.processor.running = False
                print("Camera processor stopped")
            
            # Stop system monitor
            system_monitor.stop_monitoring()
            print("System monitor stopped")
            
            # Save final stats
            stats = system_monitor.get_stats()
            print(f"Final stats: {stats['motion_alerts']} alerts, {stats['api_calls']} API calls")
            
            print("CCTV System shutdown complete")
            
        except Exception as e:
            print(f"Error during shutdown: {e}")
    
    def _signal_handler(self, signum, frame):
        """Handle system signals"""
        print(f"\nReceived signal {signum}")
        self.running = False

def main():
    """Main entry point"""
    print("CCTV Production System v1.0")
    print("Starting system initialization...")
    
    system = ProductionCCTVSystem()
    system.start()

if __name__ == "__main__":
    main()