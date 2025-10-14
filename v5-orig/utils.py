import sqlite3
import json

db_path = 'cameras.db'

def create_tables():
    try:
        connect = sqlite3.connect(db_path)
        cur = connect.cursor()
        cur.execute("""
        CREATE TABLE IF NOT EXISTS cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_name TEXT NOT NULL UNIQUE,
            rtsp_link TEXT NOT NULL,
            camera_id TEXT,
            rtsp_output TEXT
        )
        """)
        cur.execute("""
        CREATE TABLE IF NOT EXISTS rois (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER,
            name TEXT NOT NULL,
            points TEXT NOT NULL,
            FOREIGN KEY(camera_id) REFERENCES cameras(id)
        )
        """)
        connect.commit()
    except sqlite3.Error as e:
        print(f"Database error in create_tables: {e}")
    finally:
        connect.close()

#### DATABASE CAMERA FUNCTIONS ####
def add_camera(camera_name, rtsp_link, camera_id=None, rtsp_output=None):
    try:
        connect = sqlite3.connect(db_path)
        cur = connect.cursor()
        cur.execute("INSERT INTO cameras (camera_name, rtsp_link, camera_id, rtsp_output) VALUES (?, ?, ?, ?)",
                    (camera_name, rtsp_link, camera_id, rtsp_output))
        connect.commit()
        camera_db_id = cur.lastrowid
        return camera_db_id
    except sqlite3.Error as e:
        print(f"Database error in add_camera: {e}")
        return None
    finally:
        connect.close()

def get_camera():
    try:
        connect = sqlite3.connect(db_path)
        cur = connect.cursor()
        cur.execute("SELECT * FROM cameras")
        result = cur.fetchall()
        return result
    except sqlite3.Error as e:
        print(f"Database error in get_camera: {e}")
        return []
    finally:
        connect.close()

def delete_camera(camera_id):
    try:
        connect = sqlite3.connect(db_path)
        cur = connect.cursor()
        cur.execute("DELETE FROM rois WHERE camera_id = ?", (camera_id,))
        cur.execute("DELETE FROM cameras WHERE id = ?", (camera_id,))
        connect.commit()
    except sqlite3.Error as e:
        print(f"Database error in delete_camera: {e}")
    finally:
        connect.close()

#### DATABASE CAMERA ROI FUNCTIONS ####
def add_roi(camera_db_id, name, points):
    if not points or len(points) < 3:
        print("Error: ROI must have at least 3 points")
        return None
    try:
        connect = sqlite3.connect(db_path)
        cur = connect.cursor()
        points_json = json.dumps(points)
        cur.execute("INSERT INTO rois (camera_id, name, points) VALUES (?, ?, ?)",
                    (camera_db_id, name, points_json))
        connect.commit()
        roi_id = cur.lastrowid
        return roi_id
    except sqlite3.Error as e:
        print(f"Database error in add_roi: {e}")
        return None
    finally:
        connect.close()

def delete_roi(roi_id, camera_id=None):
    try:
        connect = sqlite3.connect(db_path)
        cur = connect.cursor()
        cur.execute("DELETE FROM rois WHERE id = ?", (roi_id,))
        connect.commit()
        return cur.rowcount > 0
    except sqlite3.Error as e:
        print(f"Database error in delete_roi: {e}")
        return False
    finally:
        connect.close()

def update_roi(roi_id, name, points):
    if not points or len(points) < 3:
        print("Error: ROI must have at least 3 points")
        return False
    try:
        connect = sqlite3.connect(db_path)
        cur = connect.cursor()
        points_json = json.dumps(points)
        cur.execute("UPDATE rois SET name = ?, points = ? WHERE id = ?",
                    (name, points_json, roi_id))
        connect.commit()
        return cur.rowcount > 0
    except sqlite3.Error as e:
        print(f"Database error in update_roi: {e}")
        return False
    finally:
        connect.close()

def get_rois(camera_db_id):
    try:
        connect = sqlite3.connect(db_path)
        cursor = connect.cursor()
        cursor.execute("SELECT id, name, points FROM rois WHERE camera_id = ?", (camera_db_id,))
        result = cursor.fetchall()
        return [{'id': r[0], 'name': r[1], 'points': json.loads(r[2])} for r in result]
    except sqlite3.Error as e:
        print(f"Database error in get_rois: {e}")
        return []
    finally:
        connect.close()