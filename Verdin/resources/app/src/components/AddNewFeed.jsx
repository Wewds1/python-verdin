import React, { useState, useEffect } from 'react';

function AddNewFeed({ onAddFeedToggle, onVideoAdd }) {
  const [rtspUrl, setRtspUrl] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const fetchClients = async (retryCount = 0) => {
      const maxRetries = 3;
      const retryDelay = 1000; // 1 second
      
      setClientsLoading(true);
      setClientsError('');
        try {
        const response = await fetch('http://localhost:8000/api/clients', {
          credentials: 'include'
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = await response.json();
        if (json.success) {
          setClients(Array.isArray(json.data) ? json.data : []);
        } else {
          throw new Error('Failed to fetch clients');
        }
      } catch (error) {
        console.error('Error fetching clients:', error);
        
        // Retry logic for packaged app
        if (retryCount < maxRetries && (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ECONNREFUSED'))) {
          console.log(`Retrying fetch clients... (${retryCount + 1}/${maxRetries})`);
          setTimeout(() => {
            fetchClients(retryCount + 1);
          }, retryDelay * (retryCount + 1)); // Exponential backoff
          return;
        }
        
        setClientsError('Failed to fetch clients: ' + error.message);
        setClients([]);
        setClientsLoading(false);
      }
      
      if (retryCount === 0) {
        setClientsLoading(false);
      }
    };
    
    fetchClients();
  }, []);

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) {
      onAddFeedToggle();
    }
  };

  const handleCloseClick = (event) => {
    event.preventDefault();
    // Reset form state when closing
    setLoading(false);
    setError('');
    onAddFeedToggle();
  };
  const handleAddFeed = async (event) => {
    event.preventDefault();
    setError('');
    
    // Validate individual fields
    const hasRtspError = !rtspUrl.trim();
    const hasNameError = !cameraName.trim();
    const hasClientError = !clientId;
    
    if (hasRtspError || hasNameError || hasClientError) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    
    // Add a timeout to reset loading state in case of hanging
    const timeoutId = setTimeout(() => {
      console.warn('Add feed operation timed out, resetting loading state');
      setLoading(false);
      setError('Operation timed out. Please try again.');
    }, 30000); // 30 second timeout
    
    const addFeedWithRetry = async (retryCount = 0) => {
      const maxRetries = 2;
      const retryDelay = 1000;
      
      try {
        const res = await fetch('http://localhost:8000/api/camera/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            rtspUrl: rtspUrl.trim(),
            name: cameraName.trim(),
            client_id: clientId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          const msg = data.error || data.message || `Failed to add feed (${res.status})`;
          throw new Error(msg);
        }
        
        console.log(`✅ Successfully added new video:`, data);
        
        // Call the parent callback to add the new video to the UI state
        if (onVideoAdd && data.data && data.data.source) {
          onVideoAdd(data.data.source);
        }
        
        // Reset form state on success
        setRtspUrl('');
        setCameraName('');
        setClientId('');
        setLoading(false);
        clearTimeout(timeoutId); // Clear the timeout on success
        onAddFeedToggle();
      } catch (err) {
        console.error('Add feed error:', err);
        
        // Retry logic for network errors
        if (retryCount < maxRetries && (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('ECONNREFUSED'))) {
          console.log(`Retrying add feed... (${retryCount + 1}/${maxRetries})`);
          setTimeout(() => {
            addFeedWithRetry(retryCount + 1);
          }, retryDelay * (retryCount + 1));
          return;
        }
        
        setError(err.message);
        setLoading(false);
        clearTimeout(timeoutId); // Clear the timeout on error
      }
    };
    
    try {
      await addFeedWithRetry();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      clearTimeout(timeoutId); // Clear the timeout in finally block
    }
  };

  return (
    <div
      id="add-new-feed-overlay"
      onClick={handleOverlayClick}
    >
      <form
        id="add-new-feed-window"
        onSubmit={handleAddFeed}
        onClick={(e) => e.stopPropagation()} // Prevent modal from closing when clicking inside content
      >
        <div className="window-actions">
          <a href="#" onClick={handleCloseClick} title="Close">
            <i className="fa fa-times" />
          </a>
        </div>
        <div className="window-content">
          <input
            type="text"
            name="rtsp"
            value={rtspUrl}
            placeholder="RTSP URL..."
            onChange={e => setRtspUrl(e.target.value)}
            disabled={loading}
            className={error && !rtspUrl.trim() ? 'form-input error' : 'form-input'}
          />
          <input
            type="text"
            name="name"
            value={cameraName}
            placeholder="Camera Name..."
            onChange={e => setCameraName(e.target.value)}
            disabled={loading}
            className={error && !cameraName.trim() ? 'form-input error' : 'form-input'}
          />
          {clientsLoading ? (
            <select disabled>
              <option>Loading clients...</option>
            </select>
          ) : clientsError ? (
            <div style={{ color: 'red' }}>
              Error loading clients: {clientsError}
            </div>
          ) : (
            <select
              name="client"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              disabled={loading}
              className={error && !clientId ? 'form-input error' : 'form-input'}
            >
              <option value="">Select Client</option>
              {clients.map(c => (
                <option key={c.client_id} value={c.client_id}>
                  {c.client_name}
                </option>
              ))}
            </select>
          )}
          {error && <div className="validation-error">{error}</div>}
          <button type="submit" disabled={loading || clientsLoading}>
            {loading ? 'Adding...' : 'Add Feed'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default AddNewFeed;
