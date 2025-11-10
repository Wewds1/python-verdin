import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function ExpandedVideoPage() {
  const { clientName, videoName } = useParams();
  const streamPath = `${clientName}/${videoName}`;
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [statusLabel, setStatusLabel] = useState(`Connecting to ${streamPath}...`);

  useEffect(() => {
    if (!window.MediaMTXWebRTCReader) {
      setStatusLabel(`${streamPath} - Reader not found`);
      return;
    }
    if (!clientName || !videoName) {
      setStatusLabel("Invalid path.");
      return;
    }

    let isMounted = true, retries = 0;
    const maxRetries = 5, retryDelay = 2000;
    setStatusLabel(`Connecting to ${streamPath}...`);

    const checkStream = async () => {
      if (!isMounted) return;
      try {
        const res = await fetch(`http://localhost:8889/${streamPath}/whep`, {
          method: 'OPTIONS',
          headers: { 'Accept': 'application/sdp' }
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        if (isMounted) initWebRTC();
      } catch {
        if (retries < maxRetries && isMounted) {
          retries++;
          setStatusLabel(`Retrying ${streamPath}... (${retries}/${maxRetries})`);
          setTimeout(checkStream, retryDelay);
        } else if (isMounted) {
          setStatusLabel(`${streamPath} – Stream unavailable`);
        }
      }
    };

    const initWebRTC = () => {
      if (!isMounted) return;
      try {
        readerRef.current = new window.MediaMTXWebRTCReader({
          url: `http://localhost:8889/${streamPath}/whep`,
          video: videoRef.current,
          onError: e => isMounted && setStatusLabel(`${streamPath} – ${e.message}`),
          onTrack: ev => {
            const vid = videoRef.current;
            if (vid && vid.srcObject !== ev.streams[0] && isMounted) {
              vid.srcObject = ev.streams[0];
              setStatusLabel('Connected');
              vid.play().catch(() => {
                if (isMounted) setStatusLabel('Live Feed');
              });
            }
          }
        });
      } catch {
        isMounted && setStatusLabel(`${streamPath} – Init failed`);
      }
    };

    const timeoutId = setTimeout(checkStream, 500);
    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (readerRef.current) {
        readerRef.current.close();
        readerRef.current = null;
      }
    };
  }, [clientName, videoName]);

  const handleScreenshot = e => {
    e.preventDefault();
    const vid = videoRef.current;
    if (!vid || vid.readyState !== 4) {
      const prev = statusLabel;
      setStatusLabel('Video not ready for screenshot');
      setTimeout(() => setStatusLabel(prev), 2000);
      return;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = vid.videoWidth || vid.clientWidth;
    canvas.height = vid.videoHeight || vid.clientHeight;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return console.error('Failed to create blob');
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screenshot_${streamPath.replace(/[^a-zA-Z0-9]/g, '_')}_${ts}.png`;
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      // save to server...
      setStatusLabel('Screenshot saved!');
      setTimeout(() => setStatusLabel(`Connected`), 2000);
    }, 'image/png', 0.95);
  };

  return (
    <div className="expanded-video-view">
      <div className="expanded-video-content">
        <div className="view-area">
          <video ref={videoRef} autoPlay playsInline />
        </div>
        <div className="basic-controls">
          <div className="status-area">
            {(statusLabel === 'Live Feed' || statusLabel === 'Connected')
              ? <p className="connected"><i className="fa fa-video" /> Live Feed</p>
              : <p className="disconnected"><i className="fa fa-video-slash" /> {statusLabel}</p>}
          </div>
          <div className="actions-area">
            <a href="#" onClick={handleScreenshot} title="Take Screenshot"><i className="fa fa-camera" /></a>
          </div>
        </div>
      </div>
      <div className="video-control-panel">
        <a href="#" onClick={() => navigate(-1)}><i className="fa fa-arrow-left" /> Back</a>
      </div>
    </div>
  );
}
