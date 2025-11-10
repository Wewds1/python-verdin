import psutil
import time
import threading
from datetime import datetime, timedelta
from pathlib import Path

class SystemMonitor:
    def __init__(self):
        self.start_time = datetime.now()
        self.stats = {
            'motion_alerts': 0,
            'api_calls': 0,
            'errors': 0,
            'last_motion': None,
            'cameras_active': 0,
            'rois_total': 0
        }
        self.monitoring = False
        self.monitor_thread = None
    
    def start_monitoring(self, interval=30):
        """Start system monitoring"""
        self.monitoring = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, args=(interval,))
        self.monitor_thread.daemon = True
        self.monitor_thread.start()
        print(f"📊 System monitoring started (interval: {interval}s)")
    
    def stop_monitoring(self):
        """Stop system monitoring"""
        self.monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join()
        print("System monitoring stopped")
    
    def _monitor_loop(self, interval):
        """Main monitoring loop"""
        while self.monitoring:
            try:
                self._collect_system_stats()
                time.sleep(interval)
            except Exception as e:
                print(f"Monitor error: {e}")
                time.sleep(interval)
    
    def _collect_system_stats(self):
        """Collect system statistics"""
        try:
            # System resources
            cpu_percent = psutil.cpu_percent()
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('.')
            
            # Log if resources are high
            if cpu_percent > 80:
                print(f"High CPU usage: {cpu_percent}%")
            
            if memory.percent > 80:
                print(f"High memory usage: {memory.percent}%")
            
            # Update stats
            self.stats['system'] = {
                'cpu_percent': cpu_percent,
                'memory_percent': memory.percent,
                'disk_percent': disk.percent,
                'uptime_seconds': (datetime.now() - self.start_time).total_seconds()
            }
            
        except Exception as e:
            print(f"Error collecting stats: {e}")
    
    def log_motion_alert(self, camera_name, roi_name):
        """Log motion alert"""
        self.stats['motion_alerts'] += 1
        self.stats['last_motion'] = {
            'timestamp': datetime.now().isoformat(),
            'camera': camera_name,
            'roi': roi_name
        }
    
    def log_api_call(self, endpoint):
        """Log API call"""
        self.stats['api_calls'] += 1
    
    def log_error(self, error_msg):
        """Log error"""
        self.stats['errors'] += 1
        print(f"System error logged: {error_msg}")
    
    def get_stats(self):
        """Get current system statistics"""
        uptime = datetime.now() - self.start_time
        
        return {
            **self.stats,
            'uptime': str(uptime),
            'uptime_seconds': uptime.total_seconds(),
            'status': 'healthy' if self.stats['errors'] < 10 else 'degraded'
        }
    
    def get_health_summary(self):
        """Get system health summary"""
        stats = self.get_stats()
        system_stats = stats.get('system', {})
        
        health = {
            'overall_status': 'healthy',
            'checks': {
                'cpu': 'ok' if system_stats.get('cpu_percent', 0) < 80 else 'warning',
                'memory': 'ok' if system_stats.get('memory_percent', 0) < 80 else 'warning',
                'disk': 'ok' if system_stats.get('disk_percent', 0) < 90 else 'warning',
                'errors': 'ok' if stats['errors'] < 10 else 'warning'
            },
            'stats': stats
        }
        
        # Determine overall status
        if any(check == 'warning' for check in health['checks'].values()):
            health['overall_status'] = 'warning'
        
        return health

# Global system monitor
system_monitor = SystemMonitor()