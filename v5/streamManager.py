import subprocess

class StreamingManager:
    def __init__(self, use_cuda=False):
        self.use_cuda = use_cuda
        
    def create_ffmpeg_command(self, rtsp_output):
        if self.use_cuda:
            return [
                'ffmpeg', '-y', '-f', 'rawvideo',
                '-pixel_format', 'bgr24', '-video_size', '1280x720',
                '-framerate', '25', '-i', '-',
                '-c:v', 'h264_nvenc', '-preset', 'fast', '-gpu', '0',
                '-pix_fmt', 'yuv420p', '-f', 'rtsp', rtsp_output
            ]
        else:
            return [
                'ffmpeg', '-y', '-f', 'rawvideo',
                '-pixel_format', 'bgr24', '-video_size', '1280x720',
                '-framerate', '25', '-i', '-',
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-pix_fmt', 'yuv420p', '-f', 'rtsp', rtsp_output
            ]
    
    def start_ffmpeg(self, rtsp_output):
        cmd = self.create_ffmpeg_command(rtsp_output)
        try:
            return subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except:
            return None
    
    def restart_ffmpeg(self, ffmpeg_process, rtsp_output):
        try:
            ffmpeg_process.stdin.close()
        except:
            pass
        
        try:
            ffmpeg_process.wait(timeout=1)
        except:
            ffmpeg_process.terminate()
            
        return self.start_ffmpeg(rtsp_output)
    
    def write_frame(self, ffmpeg_process, frame, rtsp_output):
        if ffmpeg_process.poll() is not None:
            ffmpeg_process = self.restart_ffmpeg(ffmpeg_process, rtsp_output)
            if ffmpeg_process is None:
                return None
        
        try:
            ffmpeg_process.stdin.write(frame.tobytes())
            return ffmpeg_process
        except:
            ffmpeg_process = self.restart_ffmpeg(ffmpeg_process, rtsp_output)
            return ffmpeg_process