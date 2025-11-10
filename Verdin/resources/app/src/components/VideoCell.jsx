import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import React from 'react';
import ContextMenu from './ContextMenu';
import Modal from './Modal';
import { useVideoStream } from '../context/VideoStreamContext';

function VideoCell({ name, clientName, path, onClick, id, onDelete, isVisible = true, sourceData, onEdit, onViewDetails, initialState = 'connecting', preserveConnection = false }) {
  const videoRef = useRef(null);
  const { videoStreams, updateStreamState, getStreamState } = useVideoStream();
  const preserveConnectionRef = useRef(preserveConnection);
  
  // Use useMemo to recalculate formatted label when dependencies change
  const formattedLabel = useMemo(() => {
    const newLabel = clientName && name ? `${clientName}: ${name}` : (name || path);
    
    return newLabel;
  }, [clientName, name, path, id]);
  
  const [connectionState, setConnectionState] = useState(() => {
    // Check for existing stream state first
    const existingState = getStreamState(path);
    if (existingState?.connectionState === 'connected') {
      return 'connected';
    }
    return initialState;
  });
  
  const [errorMessage, setErrorMessage] = useState(() => {
    const existingState = getStreamState(path);
    return existingState?.errorMessage || '';
  });

  // Add status label state
  const [customStatusLabel, setCustomStatusLabel] = useState(null);
  
  // Compute status label based on connection state
  const statusLabel = useMemo(() => {
    if (customStatusLabel) return customStatusLabel;
    
    switch(connectionState) {
      case 'connected':
        return formattedLabel;
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return `Error: ${errorMessage}`;
      default:
        return 'Initializing...';
    }
  }, [connectionState, formattedLabel, errorMessage, customStatusLabel]);
  const readerRef = useRef(null); // Ref to store the MediaMTXWebRTCReader instance
  const [contextMenu, setContextMenu] = useState({
    isVisible: false,
    position: { x: 0, y: 0 },
    triggerRect: null
  });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // Use a more comprehensive lifecycle ref
  const lifecycleRef = useRef({
    isMounted: true,
    keepAlive: true,
    lastActivity: Date.now()
  });

  // Monitor page visibility and unload
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && lifecycleRef.current.isMounted) {
        // Update last activity when page becomes visible
        lifecycleRef.current.lastActivity = Date.now();
        
        // Check and restore connection if needed
        const existingStream = getStreamState(path);
        if (existingStream?.connectionState === 'connected' && videoRef.current && !videoRef.current.srcObject) {
          videoRef.current.srcObject = existingStream.stream;
          setConnectionState('connected');
        }
      }
    };

    const handleBeforeUnload = () => {
      lifecycleRef.current.keepAlive = false;
      lifecycleRef.current.isMounted = false;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [path]);

  useEffect(() => {
    const checkRecordingStatus = async () => {
      try {
        const response = await fetch('/api/recording/status');
        const data = await response.json();
        
        if (data.success && data.activeRecordings) {
          const isCurrentlyRecording = data.activeRecordings.some(
            recording => recording.streamPath === path
          );
          
          setIsRecording(isCurrentlyRecording);
        }
      } catch (error) {
        console.warn('Failed to check recording status:', error);
      }
    };
    
    // Check recording status when component mounts, with a slight delay
    const statusCheckTimeout = setTimeout(checkRecordingStatus, 1000);
    
    return () => {
      if (statusCheckTimeout) {
        clearTimeout(statusCheckTimeout);
      }
    };
  }, [path, formattedLabel]); // Remove isRecording from dependencies to avoid cycles

  // Recording toggle functionality
  const toggleRecording = async () => {
    try {
      const newRecordingState = !isRecording;
      
      // Show immediate feedback
      const originalLabel = statusLabel;
      setCustomStatusLabel(newRecordingState ? 'Starting recording...' : 'Stopping recording...');
      
      const response = await fetch('/api/recording/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: newRecordingState ? 'start' : 'stop',
          streamPath: path,
          source: formattedLabel
        })
      });

      console.log("RECORD")
      
      const data = await response.json();
      
      if (data.success) {
        // Update state only if API call succeeded
        setIsRecording(newRecordingState);
        
        // Show success feedback with resource info
        const resourceInfo = data.activeRecordings ? ` (${data.activeRecordings}/${data.maxRecordings})` : '';
        setCustomStatusLabel(newRecordingState ? `Recording started!${resourceInfo}` : `Recording stopped!${resourceInfo}`);
        setTimeout(() => setCustomStatusLabel(null), 3000);
      } else {
        // API call failed, show error
        setCustomStatusLabel(`Recording ${newRecordingState ? 'start' : 'stop'} failed`);
        setTimeout(() => setCustomStatusLabel(null), 3000);
        console.error(`Recording ${newRecordingState ? 'start' : 'stop'} failed:`, data.error);
      }
      
    } catch (error) {
      console.error('Recording toggle failed:', error);
      
      // Show error feedback
      const originalLabel = statusLabel;
      setCustomStatusLabel('Recording toggle failed');
      setTimeout(() => setCustomStatusLabel(null), 3000);
    }
  };

  // Manual recording status refresh
  const refreshRecordingStatus = async () => {
    try {
      const response = await fetch('/api/recording/status');
      const data = await response.json();
      
      if (data.success && data.activeRecordings) {
        const isCurrentlyRecording = data.activeRecordings.some(
          recording => recording.streamPath === path
        );
        
        setIsRecording(isCurrentlyRecording);
        
        const resourceInfo = data.totalActive !== undefined ? ` (${data.totalActive}/${data.maxRecordings})` : '';
        setCustomStatusLabel(`Status refreshed${resourceInfo}`);
        setTimeout(() => setCustomStatusLabel(null), 2000);
      }
    } catch (error) {
      console.warn('Failed to refresh recording status:', error);
    }
  };

  // Screenshot functionality
  const handleScreenshot = useCallback((event) => {
    event.stopPropagation(); // Prevent triggering video onClick
    event.preventDefault();
    
    const video = videoRef.current;
    if (!video || video.readyState !== 4) {
      console.warn('Video not ready for screenshot');
      // Show notification or status update
      setCustomStatusLabel('Video not ready for screenshot');
      setTimeout(() => setCustomStatusLabel(null), 2000);
      return;
    }

    try {
      // Create canvas with video dimensions
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Set canvas size to match video
      canvas.width = video.videoWidth || video.clientWidth;
      canvas.height = video.videoHeight || video.clientHeight;
      
      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert to blob and download
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          
          // Generate filename with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `screenshot_${formattedLabel.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.png`;
          
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          
          // Also save to server
          canvas.toDataURL('image/png', 0.95);
          const imageData = canvas.toDataURL('image/png', 0.95);
          
          fetch('/api/screenshot', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              imageData: imageData,
              filename: filename,
              source: formattedLabel
            })
          })
          .then(response => response.json())
          .catch(error => {
            console.warn('Error saving screenshot to server:', error);
          });
          
          // Show success feedback
          setCustomStatusLabel('Screenshot saved!');
          setTimeout(() => setCustomStatusLabel(null), 2000);
        } else {
          throw new Error('Failed to create image blob');
        }
      }, 'image/png', 0.95);
      
    } catch (error) {
      console.error('Screenshot failed:', error);
      
      // Show error feedback
      setCustomStatusLabel('Screenshot failed');
      setTimeout(() => setCustomStatusLabel(null), 2000);
    }
  }, [formattedLabel, statusLabel]);

  const handleEllipsisClick = (event) => {
    event.stopPropagation(); // Prevent triggering video onClick
    event.preventDefault();
    
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      isVisible: true,
      position: {
        x: rect.left,
        y: rect.bottom + 2
      },
      triggerRect: rect
    });
  };

  const closeContextMenu = () => {
    setContextMenu({
      isVisible: false,
      position: { x: 0, y: 0 },
      triggerRect: null
    });
  };

  const contextMenuItems = [
    {
      label: 'Edit',
      icon: 'fa-solid fa-edit',
      onClick: () => {
        closeContextMenu();
        if (onEdit && sourceData) {
          onEdit(sourceData);
        }
      }
    },
    {
      label: 'Reload',
      icon: 'fa-solid fa-refresh',
      onClick: () => {
        window.location.reload();
      }
    },
    {
      label: 'View Details',
      icon: 'fa-solid fa-info-circle',
      onClick: () => {
        closeContextMenu();
        if (onViewDetails && sourceData) {
          onViewDetails(sourceData);
        }
      }
    },
    {
      label: isRecording ? 'Stop Recording' : 'Start Recording',
      icon: isRecording ? 'fa-solid fa-stop' : 'fa-solid fa-record-vinyl',
      recording: isRecording,
      onClick: () => {
        closeContextMenu();
        toggleRecording();
      }
    },
    {
      label: 'Refresh Status',
      icon: 'fa-solid fa-sync',
      onClick: () => {
        closeContextMenu();
        refreshRecordingStatus();
      }
    },
    {
      label: 'Delete',
      icon: 'fa-solid fa-trash',
      danger: true,
      onClick: () => {
        setShowConfirmDialog(true);
        closeContextMenu();
      }
    }
  ];

  // Confirm delete video feed
  const confirmDelete = () => {
    deleteVideoFeed(id);
    setShowConfirmDialog(false);
  };

  // Cancel delete
  const cancelDelete = () => {
    setShowConfirmDialog(false);
  };

  const deleteVideoFeed = async (sourceId) => {
    try {
      const response = await fetch(`http://localhost:8000/api/sources/${sourceId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const result = await response.json();

        closeContextMenu();
        
        if (onDelete) {
          onDelete(sourceId, name);
        }
      } else {
        console.error(`❌ Response not ok. Status: ${response.status}`);
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response' }));
        console.error(`❌ Error data:`, errorData);
        alert(`Failed to delete video source: ${errorData.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error(`💥 Exception caught while deleting video source:`, error);
      alert(`Error deleting video source: ${error.message}`);
    }
  };

  // Flags to track component state and WebRTC connection
  const isComponentMounted = useRef(true);
  const shouldKeepConnection = useRef(true);

  useEffect(() => {
    if (!window.MediaMTXWebRTCReader) {
      console.error("MediaMTXWebRTCReader not found. Please ensure reader.js is loaded.");
      setStatusLabel(`${formattedLabel} - Reader not found`);
      return;
    }

    // Reset component state
    isComponentMounted.current = true;
    shouldKeepConnection.current = true;
    
    const currentLabel = formattedLabel;
    let retryAttempts = 0;
    const maxRetryAttempts = 5;
    const retryDelay = 2000; // 2 seconds between retries
    
    // Enhanced stream availability check with retry logic
    const checkStreamWithRetry = async () => {
      if (!isComponentMounted.current) return;
      
      // First check if we can reuse an existing connection
      const currentStream = getStreamState(path);
      if (currentStream?.connectionState === 'connected') {
        console.log(`🔁 Attempting to reuse existing connection for ${path}`);
        
        // Verify the connection is actually still good
        if (currentStream.webrtc?.pc?.connectionState === 'connected' && currentStream.stream) {
          if (videoRef.current && !videoRef.current.srcObject) {
            console.log(`✅ Successfully reused existing connection for ${path}`);
            videoRef.current.srcObject = currentStream.stream;
            setConnectionState('connected');
            setErrorMessage('');
            return true;
          }
        } else {
          // Clean up stale connection
          console.log(`🔄 Cleaning up stale connection for ${path}`);
          updateStreamState(path, null);
        }
      }
      
      // If we get here, we need to establish a new connection
      if (!isComponentMounted.current) return;
      setConnectionState('connecting');
      
      try {
        const response = await fetch(`http://localhost:8889/${path}/whep`, {
          method: 'OPTIONS',
          headers: {
            'Accept': 'application/sdp'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Stream not available: ${response.status} ${response.statusText}`);
        }
        
        // Stream is available, proceed with WebRTC connection
        if (isComponentMounted) {
          initWebRTC();
        }
      } catch (error) {
        console.error(`❌ ${path} - Stream check failed (attempt ${retryAttempts + 1}):`, error);
        
        if (retryAttempts < maxRetryAttempts && isComponentMounted) {
          retryAttempts++;
          setConnectionState('connecting');
          setErrorMessage(`Retrying... (${retryAttempts}/${maxRetryAttempts})`);
          
          setTimeout(() => {
            if (isComponentMounted) {
              checkStreamWithRetry();
            }
          }, retryDelay);
        } else if (isComponentMounted) {
          setConnectionState('error');
          setErrorMessage('Stream unavailable');
        }
      }
    };
    
    const initWebRTC = async () => {
      if (!isComponentMounted) return;
      
      try {
        const client_name = clientName.toLowerCase().replace(/\s/g, "");
        
        // Check if we already have an active stream
        const existingStream = getStreamState(path);
        if (existingStream?.connectionState === 'connected' || existingStream?.webrtc) {
          if (videoRef.current) {
            if (existingStream.stream && !videoRef.current.srcObject) {
              console.log(`🔄 Reusing existing stream for ${path}`);
              videoRef.current.srcObject = existingStream.stream;
              setConnectionState('connected');
              setErrorMessage('');
              return;
            }
            
            if (existingStream.webrtc && existingStream.webrtc.pc?.connectionState !== 'connected') {
              // Try to reconnect the existing WebRTC instance
              console.log(`🔄 Reconnecting existing WebRTC for ${path}`);
              try {
                await existingStream.webrtc.start();
                console.log(`✅ Successfully reconnected WebRTC for ${path}`);
                return;
              } catch (err) {
                console.error(`❌ Failed to restart existing WebRTC for ${path}:`, err);
                // Clean up failed connection before creating new one
                existingStream.webrtc.close();
                updateStreamState(path, null);
              }
            } else if (existingStream.webrtc?.pc?.connectionState === 'connected') {
              console.log(`✅ WebRTC connection already established for ${path}`);
              return;
            }
          }
        }
        
        console.log(`🔵 Creating new WebRTC connection for ${path}`);
        // Initialize MediaMTXWebRTCReader
        readerRef.current = new window.MediaMTXWebRTCReader({
          url: `http://localhost:8889/${path}/whep`,
          onError: err => {
            console.error(`❌ ${path} - WebRTC error:`, err);
            if (isComponentMounted) {
              setConnectionState('error');
              setErrorMessage(err.message || 'Connection failed');
              updateStreamState(path, {
                connectionState: 'error',
                errorMessage: err.message || 'Connection failed',
                webrtc: readerRef.current,
                stream: null
              });
            }
          },
          onTrack: ev => {
            if (videoRef.current && videoRef.current.srcObject !== ev.streams[0] && isComponentMounted) {
              videoRef.current.srcObject = ev.streams[0];
              setConnectionState('connected');
              setErrorMessage('');
              updateStreamState(path, {
                connectionState: 'connected',
                errorMessage: '',
                webrtc: readerRef.current,
                stream: ev.streams[0]
              });
            }
          }
        });
      } catch (error) {
        console.error(`💥 ${path} - Failed to initialize WebRTC reader:`, error);
        if (isComponentMounted) {
          setStatusLabel(`${currentLabel} – Init failed`);
        }
      }
    };
    
    // Start with shorter initial delay but add retry mechanism
    const initTimeout = setTimeout(checkStreamWithRetry, 500); // 500ms initial delay

    return () => {
      isComponentMounted.current = false; // Mark component as unmounted
      shouldKeepConnection.current = preserveConnectionRef.current; // Only close if not preserving
      
      if (initTimeout) {
        clearTimeout(initTimeout);
      }
      
      // Only close the connection if we're actually closing the page
      if (readerRef.current) {
        const existingState = getStreamState(path);
        if (existingState?.connectionState === 'connected' && shouldKeepConnection.current) {
          // Keep the connection alive during normal navigation
          console.log(`🔵 Keeping WebRTC connection alive for ${path}`);
          
          // Store the video stream state for reuse
          if (videoRef.current?.srcObject) {
            updateStreamState(path, {
              ...existingState,
              stream: videoRef.current.srcObject
            });
          }
          return;
        }
        
        try {
          // Only close and cleanup if we're actually leaving the page
          if (!shouldKeepConnection.current) {
            console.log(`🔴 Closing WebRTC connection for ${path} (page unload)`);
            readerRef.current.close();
            readerRef.current = null;
            updateStreamState(path, null);
          }
        } catch (error) {
          console.error(`⚠️ Error closing WebRTC reader for ${path}:`, error);
        }
      }
    };
  }, [path, id]); // Depend on both path and id for better tracking

  const handleVideoClick = useCallback(() => {
    if (onClick) onClick(path);
  }, [onClick]);

  return (
    <div 
      id={id} 
      className={`cell ${!isVisible ? 'filtered-out' : ''} ${isRecording ? 'recording' : ''}`}
      style={{ 
        display: isVisible ? 'block' : 'none'
      }}
    >
      <video
        onClick={handleVideoClick}
        ref={videoRef}
        autoPlay
        playsInline
        muted
      ></video>
      <div className="video-details">
        <div className="label">
          {statusLabel}
        </div>
        <div className="video-actions">
          <a href="#" onClick={handleScreenshot} title="Take Screenshot">
            <i className="fa-solid fa-camera"></i>
          </a>
          <a href="#" onClick={handleEllipsisClick}>
            <i className="fa-solid fa-ellipsis-vertical"></i>
          </a>
          {/* <a href="#" onClick={toggleRecording} title={isRecording ? "Stop Recording" : "Start Recording"}>
            <i className={`fa-solid ${isRecording ? 'fa-stop' : 'fa-circle'} recording-icon`}></i>
          </a> */}
        </div>
      </div>
      
      <ContextMenu
        isVisible={contextMenu.isVisible}
        position={contextMenu.position}
        onClose={closeContextMenu}
        items={contextMenuItems}
        triggerRect={contextMenu.triggerRect}
      />
      
      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <Modal isOpen={showConfirmDialog} onClose={cancelDelete}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Confirm Delete</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete the video feed "{formattedLabel}"?</p>
              <p style={{ color: '#ffc107', marginTop: '10px' }}>
                <strong>Warning:</strong> This action cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelDelete}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default React.memo(VideoCell, (prevProps, nextProps) => {
  // Custom comparison function - only re-render if these specific props change
  return (
    prevProps.id === nextProps.id &&
    prevProps.name === nextProps.name &&
    prevProps.clientName === nextProps.clientName &&
    prevProps.path === nextProps.path &&
    prevProps.isVisible === nextProps.isVisible &&
    prevProps.onClick === nextProps.onClick &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onViewDetails === nextProps.onViewDetails &&
    prevProps.sourceData === nextProps.sourceData
  );
});
