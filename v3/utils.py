import sqlite3
import json

db_path = 'cameras.db'

def create_tables():
    connect = sqlite3.connect(db_path)
    cur = connect.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS cameras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_name TEXT NOT NULL,
        rtsp_link TEXT NOT NULL,
        camera_id TEXT,
        rtsp_output TEXT
    )
    """)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS rois (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id INTEGER,
        name TEXT,
        points TEXT,
        FOREIGN KEY(camera_id) REFERENCES cameras(id)
    )
    """)
    connect.commit()
    connect.close()

#### DATABASE CAMERA FUNCTIONS ####    
def add_camera(camera_name, rtsp_link, camera_id=None, rtsp_output=None):
    connect = sqlite3.connect(db_path)
    cur = connect.cursor()
    cur.execute("INSERT INTO cameras (camera_name, rtsp_link, camera_id, rtsp_output) VALUES (?, ?, ?, ?)",
                (camera_name, rtsp_link, camera_id, rtsp_output))
    connect.commit()
    camera_db_id = cur.lastrowid
    connect.close()
    return camera_db_id

def get_camera():
    connect = sqlite3.connect(db_path)
    cur = connect.cursor()
    cur.execute("SELECT * FROM cameras")
    result = cur.fetchall()
    connect.close()
    return result

def delete_camera(camera_id):
    connect = sqlite3.connect(db_path)
    cur = connect.cursor()
    cur.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
    connect.commit()
    connect.close()

#### DATABASE CAMERA ROI FUNCTIONS ####
def add_roi(camera_db_id, name, points):
    connect = sqlite3.connect(db_path)
    cur = connect.cursor()
    points_json = json.dumps(points)
    cur.execute("INSERT INTO rois (camera_id, name, points) VALUES (?, ?, ?)",
                (camera_db_id, name, points_json))
    connect.commit()
    connect.close()

def delete_roi(roi_id, camera_id=None):
    connect = sqlite3.connect(db_path)
    cur = connect.cursor()
    cur.execute("DELETE FROM rois WHERE id = ?", (roi_id,))
    connect.commit()
    connect.close()

def update_roi(roi_id, name, points):
    connect = sqlite3.connect(db_path)
    cur = connect.cursor()
    points_json = json.dumps(points)
    cur.execute("UPDATE rois SET name=?, points=? WHERE id=?", (name, points_json, roi_id))
    connect.commit()
    connect.close()

def get_rois(camera_db_id):
    connect  = sqlite3.connect(db_path)
    cursor = connect.cursor()
    cursor.execute("SELECT id, name, points FROM rois WHERE camera_id=?", (camera_db_id,))
    result = cursor.fetchall()
    connect.close()
    return [{'id': r[0], 'name': r[1], 'points': json.loads(r[2])} for r in result]


