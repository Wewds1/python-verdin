import React, { useState, useEffect } from 'react';

const MotionDetectionWidget = () => {
    const [status, setStatus] = useState({
        running: false,
        loading: false,
        error: null
    });
    
    const [alerts, setAlerts] = useState([]);
    const [isVisible, setIsVisible] = useState(true);

    // Check motion system status on component mount
    useEffect(() => {
        checkMotionStatus();
        
        // Check status every 30 seconds
        const statusInterval = setInterval(checkMotionStatus, 30000);
        
        // Check for alerts every 10 seconds (if system is running)
        const alertInterval = setInterval(() => {
            if (status.running) {
                checkForAlerts();
            }
        }, 10000);

        return () => {
            clearInterval(statusInterval);
            clearInterval(alertInterval);
        };
    }, [status.running]);

    const checkMotionStatus = async () => {
        try {
            if (window.electronAPI && window.electronAPI.getMotionStatus) {
                const result = await window.electronAPI.getMotionStatus();
                setStatus(prev => ({
                    ...prev,
                    running: result.running,
                    error: result.error || null
                }));
            }
        } catch (error) {
            console.error('Error checking motion status:', error);
            setStatus(prev => ({
                ...prev,
                running: false,
                error: error.message
            }));
        }
    };

    const checkForAlerts = async () => {
        try {
            // Check for recent alerts via direct API call
            const response = await fetch('http://localhost:5001/api/alerts/recent');
            if (response.ok) {
                const newAlerts = await response.json();
                setAlerts(newAlerts.slice(0, 5)); // Keep last 5 alerts
            }
        } catch (error) {
            // Silently ignore - API might not be available
        }
    };

    const startMotionDetection = async () => {
        setStatus(prev => ({ ...prev, loading: true, error: null }));
        
        try {
            if (window.electronAPI && window.electronAPI.startMotionDetection) {
                const result = await window.electronAPI.startMotionDetection();
                
                if (result.success) {
                    setStatus(prev => ({ ...prev, running: true, loading: false }));
                    
                    // Sync existing cameras
                    setTimeout(() => {
                        if (window.electronAPI.motionDetection) {
                            window.electronAPI.motionDetection.syncCameras();
                        }
                    }, 3000);
                } else {
                    setStatus(prev => ({
                        ...prev,
                        loading: false,
                        error: result.error || 'Failed to start motion detection'
                    }));
                }
            }
        } catch (error) {
            setStatus(prev => ({
                ...prev,
                loading: false,
                error: error.message
            }));
        }
    };

    const stopMotionDetection = async () => {
        try {
            if (window.electronAPI && window.electronAPI.stopMotionDetection) {
                await window.electronAPI.stopMotionDetection();
                setStatus(prev => ({ ...prev, running: false }));
                setAlerts([]);
            }
        } catch (error) {
            console.error('Error stopping motion detection:', error);
        }
    };

    const getStatusColor = () => {
        if (status.loading) return '#ffc107'; // Yellow
        if (status.error) return '#dc3545';   // Red
        if (status.running) return '#28a745'; // Green
        return '#6c757d'; // Gray
    };

    const getStatusText = () => {
        if (status.loading) return 'STARTING...';
        if (status.error) return 'ERROR';
        if (status.running) return 'ACTIVE';
        return 'STOPPED';
    };

    if (!isVisible) {
        return (
            <div 
                style={{
                    position: 'fixed',
                    top: '20px',
                    right: '20px',
                    zIndex: 1000,
                    background: getStatusColor(),
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
                }}
                onClick={() => setIsVisible(true)}
                title="Click to expand motion detection panel"
            >
                🚨 MOTION: {getStatusText()}
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '15px',
            minWidth: '280px',
            maxWidth: '350px',
            boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
            fontSize: '14px'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: getStatusColor(),
                        marginRight: '8px'
                    }}></div>
                    <strong>Motion Detection</strong>
                </div>
                <button
                    onClick={() => setIsVisible(false)}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '16px',
                        cursor: 'pointer',
                        padding: '0',
                        color: '#666'
                    }}
                >
                    ✕
                </button>
            </div>

            {/* Status */}
            <div style={{ marginBottom: '12px' }}>
                <div style={{ fontWeight: 'bold', color: getStatusColor() }}>
                    Status: {getStatusText()}
                </div>
                {status.error && (
                    <div style={{ color: '#dc3545', fontSize: '12px', marginTop: '4px' }}>
                        {status.error}
                    </div>
                )}
            </div>

            {/* Controls */}
            <div style={{ marginBottom: '15px' }}>
                {!status.running ? (
                    <button
                        onClick={startMotionDetection}
                        disabled={status.loading}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            backgroundColor: status.loading ? '#6c757d' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: status.loading ? 'not-allowed' : 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        {status.loading ? '⏳ Starting...' : '▶️ Start Motion Detection'}
                    </button>
                ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={stopMotionDetection}
                            style={{
                                flex: 1,
                                padding: '8px 12px',
                                backgroundColor: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            🛑 Stop
                        </button>
                        <button
                            onClick={checkMotionStatus}
                            style={{
                                flex: 1,
                                padding: '8px 12px',
                                backgroundColor: '#007bff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            🔄 Refresh
                        </button>
                    </div>
                )}
            </div>

            {/* Recent Alerts */}
            {status.running && (
                <div>
                    <div style={{ 
                        fontWeight: 'bold', 
                        marginBottom: '8px',
                        fontSize: '13px'
                    }}>
                        Recent Alerts ({alerts.length})
                    </div>
                    <div style={{
                        maxHeight: '120px',
                        overflowY: 'auto',
                        border: '1px solid #eee',
                        borderRadius: '4px',
                        backgroundColor: '#f8f9fa'
                    }}>
                        {alerts.length === 0 ? (
                            <div style={{
                                padding: '12px',
                                textAlign: 'center',
                                color: '#666',
                                fontSize: '12px'
                            }}>
                                No motion detected yet
                            </div>
                        ) : (
                            alerts.map((alert, index) => (
                                <div
                                    key={index}
                                    style={{
                                        padding: '8px 10px',
                                        borderBottom: index < alerts.length - 1 ? '1px solid #dee2e6' : 'none',
                                        fontSize: '12px'
                                    }}
                                >
                                    <div style={{ fontWeight: 'bold', color: '#dc3545' }}>
                                        🚨 {alert.camera_name || 'Unknown Camera'}
                                    </div>
                                    <div style={{ color: '#666' }}>
                                        {new Date(alert.timestamp * 1000).toLocaleString()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Quick Actions */}
            {status.running && (
                <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                    <div>API: http://localhost:5001</div>
                    <div>Dashboard: 
                        <a 
                            href="#" 
                            onClick={(e) => {
                                e.preventDefault();
                                if (window.electronAPI && window.electronAPI.openExternal) {
                                    window.electronAPI.openExternal('http://localhost:8080/dashboard.html');
                                }
                            }}
                            style={{ color: '#007bff', marginLeft: '4px' }}
                        >
                            Open
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MotionDetectionWidget;