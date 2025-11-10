from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Tuple, Optional, Dict, Any
import threading
import uvicorn
import time

# Global controller reference
_controller = None

# FastAPI app
app = FastAPI(
    title="CCTV Control API",
    description="API to control CCTV motion detection system",
    version="1.0.0"
)

# Enable CORS for JavaScript clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request/Response models
class YoloFilterRequest(BaseModel):
    enabled: bool

class ViewResolutionRequest(BaseModel):
    width: int = Field(gt=0, le=3840)
    height: int = Field(gt=0, le=2160)

class NotificationsRequest(BaseModel):
    enabled: bool

class ROIRequest(BaseModel):
    name: str
    points: List[Tuple[int, int]]

class StatusResponse(BaseModel):
    yolo_filtering: bool
    view_resolution: Tuple[int, int]
    notifications_enabled: bool
    cameras: List[str]
    yolo_classes: List[int]

class ROIResponse(BaseModel):
    id: int
    name: str
    points: List[Tuple[int, int]]

# API Endpoints
@app.get("/")
async def root():
    return {
        "service": "CCTV Control API",
        "version": "1.0.0",
        "status": "running",
        "controller_ready": _controller is not None,
        "timestamp": time.time(),
        "endpoints": {
            "status": "/status",
            "health": "/health",
            "docs": "/docs",
            "openapi": "/openapi.json"
        }
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "controller_ready": _controller is not None,
        "timestamp": time.time()
    }

@app.get("/status", response_model=StatusResponse)
async def get_status():
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        status = _controller.get_camera_status()
        return StatusResponse(**status)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get status: {str(e)}")

@app.post("/settings/yolo")
async def set_yolo_filtering(request: YoloFilterRequest):
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        _controller.set_yolo_filtering(request.enabled)
        return {"success": True, "enabled": request.enabled}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set YOLO filtering: {str(e)}")

@app.post("/settings/view")
async def set_view_resolution(request: ViewResolutionRequest):
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        print(f"API: Setting view resolution to {request.width}x{request.height}")
        _controller.set_view_resolution(request.width, request.height)
        return {"success": True, "width": request.width, "height": request.height}
    except Exception as e:
        print(f"API: Error setting view resolution: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to set view resolution: {str(e)}")

@app.post("/settings/notifications")
async def set_notifications(request: NotificationsRequest):
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        _controller.set_notifications_enabled(request.enabled)
        return {"success": True, "enabled": request.enabled}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set notifications: {str(e)}")

@app.get("/cameras")
async def get_cameras():
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        # Try the method, fall back if it doesn't exist
        if hasattr(_controller, 'list_cameras'):
            cameras = _controller.list_cameras()
        else:
            # Fallback - get from videos_index or return empty
            cameras = list(getattr(_controller, 'videos_index', {}).keys())
        
        return {"cameras": cameras}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get cameras: {str(e)}")


@app.get("/cameras/{camera_name}/rois")
async def get_camera_rois(camera_name: str):
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        if camera_name not in _controller.videos_index:
            raise HTTPException(status_code=404, detail="Camera not found")
        
        video = _controller.videos_index[camera_name]
        rois = [{"id": r.id, "name": r.name, "points": r.points} for r in video.rois]
        return {"rois": rois}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get ROIs: {str(e)}")

@app.post("/cameras/{camera_name}/rois")
async def add_roi(camera_name: str, request: ROIRequest):
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        # Check if camera exists in videos_index
        videos_index = getattr(_controller, 'videos_index', {})
        if camera_name not in videos_index:
            # Try to get from database directly
            try:
                from utils import get_camera, get_rois
                cameras = get_camera()
                camera_id = None
                for cam in cameras:
                    if cam[1] == camera_name:  # cam[1] is camera name
                        camera_id = cam[0]  # cam[0] is camera id
                        break
                
                if camera_id:
                    rois = get_rois(camera_id)
                    return {"rois": rois}
                else:
                    raise HTTPException(status_code=404, detail="Camera not found")
            except Exception as e:
                raise HTTPException(status_code=404, detail="Camera not found")
        
        video = videos_index[camera_name]
        rois = [{"id": r.id, "name": r.name, "points": r.points} for r in video.rois]
        return {"rois": rois}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get ROIs: {str(e)}")

@app.put("/cameras/{camera_name}/rois/{roi_id}")
async def update_roi(camera_name: str, roi_id: int, request: ROIRequest):
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        if camera_name not in _controller.videos_index:
            raise HTTPException(status_code=404, detail="Camera not found")
        
        from utils import update_roi as db_update_roi
        success = db_update_roi(roi_id, request.name, request.points)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update ROI")
        
        # Refresh ROIs in memory
        _controller.refresh_rois(camera_name)
        
        return {"success": True, "id": roi_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update ROI: {str(e)}")

@app.delete("/cameras/{camera_name}/rois/{roi_id}")
async def delete_roi(camera_name: str, roi_id: int):
    if not _controller:
        raise HTTPException(status_code=503, detail="Controller not ready")
    
    try:
        if camera_name not in _controller.videos_index:
            raise HTTPException(status_code=404, detail="Camera not found")
        
        from utils import delete_roi as db_delete_roi
        success = db_delete_roi(roi_id)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to delete ROI")
        
        # Refresh ROIs in memory
        _controller.refresh_rois(camera_name)
        
        return {"success": True, "deleted": roi_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete ROI: {str(e)}")

# Utility functions
def start_api(controller, host="127.0.0.1", port=5001):
    global _controller
    _controller = controller
    
    print(f"Starting Control API on {host}:{port}")
    
    def run_server():
        try:
            config = uvicorn.Config(
                app, 
                host=host, 
                port=port, 
                log_level="info",  # Changed to info for debugging
                access_log=True    # Enable access logs
            )
            
            server = uvicorn.Server(config)
            print(f"✓ Control API server starting...")
            
            # Run server in this thread
            import asyncio
            asyncio.run(server.serve())
            
        except Exception as e:
            print(f"❌ Control API server error: {e}")
            import traceback
            traceback.print_exc()
    
    thread = threading.Thread(target=run_server, daemon=True)
    thread.start()
    
    # Wait for server to start
    import time
    time.sleep(3)
    
    print(f"✓ Control API should be running at http://{host}:{port}")
    print(f"✓ Try: curl http://{host}:{port}/health")
    
    return thread

if __name__ == "__main__":
    print("This module should be imported and started via start_api()")
    uvicorn.run(app, host="127.0.0.1", port=5001)