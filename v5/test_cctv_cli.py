import pytest
from cctv_cli import CCTVController

@pytest.fixture
def controller():
    """Fixture to create a CCTVController instance."""
    return CCTVController()

def test_start_camera(controller):
    """Test starting a camera."""
    result = controller.start_camera("TestCamera", "rtsp://example.com/stream")
    assert result["status"] == "started"
    assert "TestCamera" in controller.running_cameras

def test_stop_camera(controller):
    """Test stopping a camera."""
    controller.start_camera("TestCamera", "rtsp://example.com/stream")
    result = controller.stop_camera("TestCamera")
    assert result["status"] == "stopped"
    assert "TestCamera" not in controller.running_cameras

def test_stop_nonexistent_camera(controller):
    """Test stopping a camera that is not running."""
    result = controller.stop_camera("NonexistentCamera")
    assert result["status"] == "not_running"