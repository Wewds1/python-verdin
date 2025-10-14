import sqlite3 
import os


db_path = 'cameras.db'


def init_db():
    connect = sqlite3.connect(db_path)
    c = connect.cursor()

    c.execute("""
    CREATE TABLE IF NOT EXISTS cameras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        rtsp_link TEXT NOT NULL,
        width INTEGER DEFAULT 1280,
        height INTEGER DEFAULT 720
        )
    """)

    c.execute("""
    CREATE TABLE IF NOT EXISTS rois(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        camera_id INTEGER,
        name TEXT,
        x INTEGER,
        y INTEGER,
        w INTEGER,
        h INTEGER,
        FOREIGN KEY (camera_id) REFERENCES cameras(id) on DELETE CASCADE
              )
        """)
    connect.commit()
    connect.close()

def add_camera(name, rtsp_link, width=1280, height=720):
    connect = sqlite3.connect(db_path)
    c = connect.cursor()
    c.execute("INSERT INTO cameras (name, rtsp_link, width, height) VALUES (?, ?, ?, ?)", (name, rtsp_link, width, height))
    connect.commit()
    connect.close()

def get_cameras():
    connect = sqlite3.connect(db_path)
    c = connect.cursor()
    c.execute("SELECT * FROM cameras")
    cam = c.fetchall()
    connect.close()
    return cam


def add_rois(camera_id, name, x, y, w, h):
    connect = sqlite3.connect(db_path)
    c = connect.cursor()
    c.execute("INSERT INTO rois (camera_id, name, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?)", (camera_id, name, x, y, w, h))
    connect.commit()
    connect.close()

def get_rois():
    connect = sqlite3.connect(db_path)
    c = connect.cursor()
    c.execute("SELECT * FROM rois")
    rois = c.fetchall()
    connect.close()
    return rois


