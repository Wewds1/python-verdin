import sys
import cv2
from PySide6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QPushButton, QLabel, QLineEdit, QDialogButtonBox, QDialog, QScrollArea, QSizePolicy
)
from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QImage, QPixmap, QPalette, QColor

from db import add_camera, add_rois, init_db, get_cameras

class CameraWidget(QWidget):
    def __init__(self, rtsp_link, camera_name):
        super().__init__()
        self.rtsp_link = rtsp_link
        self.camera_name = camera_name
        self.cap = cv2.VideoCapture(rtsp_link)
        self.label = QLabel(f"Loading {camera_name}...")
        self.label.setAlignment(Qt.AlignCenter)
        self.label.setStyleSheet("background-color: black; color: white;")
        self.label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        layout = QVBoxLayout()
        layout.setContentsMargins(2, 2, 2, 2)
        layout.addWidget(self.label)
        self.setLayout(layout)
        self.timer = QTimer()
        self.timer.timeout.connect(self.update_frame)
        self.timer.start(30)

    def update_frame(self):
        if self.cap.isOpened():
            ret, frame = self.cap.read()
            if ret:
                rgb_image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                h, w, ch = rgb_image.shape
                bytes_per_line = ch * w
                q_img = QImage(rgb_image.data, w, h, bytes_per_line, QImage.Format_RGB888)
                # Scale to current label size for responsiveness
                pixmap = QPixmap.fromImage(q_img).scaled(
                    self.label.width(), self.label.height(), Qt.KeepAspectRatio, Qt.SmoothTransformation
                )
                self.label.setPixmap(pixmap)
            else:
                self.label.setText(f"Failed to load {self.camera_name}")
        else:
            self.label.setText(f"Stream not available for {self.camera_name}")

    def close(self):
        self.cap.release()

class AddCamera(QDialog):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Add Camera")
        self.setStyleSheet("background-color: #2E2E2E; color: white;")
        self.setFixedSize(400, 200)
        self.rtsp_input = QLineEdit()
        self.rtsp_input.setPlaceholderText("RTSP URL")
        self.rtsp_input.setStyleSheet("padding: 5px")
        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("Camera Name")
        self.name_input.setStyleSheet("padding: 5px")
        layout = QVBoxLayout()
        layout.addWidget(QLabel("RTSP URL: "))
        layout.addWidget(self.rtsp_input)
        layout.addWidget(QLabel("Camera Name: "))
        layout.addWidget(self.name_input)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        self.setLayout(layout)

    def get_inputs(self):
        return self.rtsp_input.text().strip(), self.name_input.text().strip()

class MainWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("CCTV Hanibal")
        self.setMinimumSize(400, 300)
        # Set black background
        palette = self.palette()
        palette.setColor(QPalette.Window, QColor("black"))
        self.setPalette(palette)
        self.setAutoFillBackground(True)

        self.cameras = []
        self.layout = QVBoxLayout(self)
        self.top_bar = QHBoxLayout()
        self.top_bar.addStretch()
        add_btn = QPushButton("Add Camera")
        add_btn.setStyleSheet("""
            QPushButton {
                background-color: #00aaff;
                color: white;
                border-radius: 5px;
                padding: 8px 16px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #0088cc;
            }
        """)
        add_btn.clicked.connect(self.add_camera)
        self.top_bar.addWidget(add_btn)
        self.layout.addLayout(self.top_bar)

        # Responsive camera grid inside a scroll area
        self.grid_widget = QWidget()
        self.grid_layout = QGridLayout(self.grid_widget)
        self.grid_layout.setSpacing(5)
        self.grid_widget.setStyleSheet("background-color: black;")
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setWidget(self.grid_widget)
        self.layout.addWidget(self.scroll)

        self.load_cameras()

    def load_cameras(self):
        # Remove old widgets
        for cam in self.cameras:
            cam.close()
            cam.setParent(None)
        self.cameras.clear()
        # Add from DB
        cameras = get_cameras()
        cols = 2  # Change to 3 or 4 for more columns
        for idx, cam in enumerate(cameras):
            cam_id, rtsp_link, name, width, height = cam
            cam_widget = CameraWidget(rtsp_link, name)
            row, col = divmod(idx, cols)
            self.grid_layout.addWidget(cam_widget, row, col)
            self.cameras.append(cam_widget)

    def add_camera(self):
        camera = AddCamera()
        if camera.exec() == QDialog.Accepted:
            rtsp_url, camera_name = camera.get_inputs()
            if rtsp_url and camera_name:
                add_camera(rtsp_url, camera_name)
                self.load_cameras()  # Refresh grid
                print(f"Camera added: {camera_name} with RTSP URL: {rtsp_url}")
            else:
                print("Invalid input. Please enter both RTSP URL and Camera Name.")

    def resizeEvent(self, event):
        # Force all camera widgets to update their video size
        for cam in self.cameras:
            cam.update_frame()
        super().resizeEvent(event)

    def closeEvent(self, event):
        for cam in self.cameras:
            cam.close()
        event.accept()

if __name__ == "__main__":
    init_db()
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())