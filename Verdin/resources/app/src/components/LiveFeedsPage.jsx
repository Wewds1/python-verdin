import VideoCell from './VideoCell';
import AddNewFeed from './AddNewFeed';
import Modal from './Modal';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Sortable from 'sortablejs';
import { useVideoStream } from '../context/VideoStreamContext';

export default function LiveFeedsPage() {
    const { videoStreams } = useVideoStream();
    const [data, setData] = useState(null);
    const [videoPath, setVideoPath] = useState(null);
    const [addFeedOpen, setAddFeedOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState('all');
    const [showViewDetailsModal, setShowViewDetailsModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [selectedSource, setSelectedSource] = useState(null);
    const [editFormData, setEditFormData] = useState({ name: '', rtsp_link: '', client_id: '' });
    const [editFormErrors, setEditFormErrors] = useState({});
    const [clients, setClients] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [notification, setNotification] = useState({ show: false, message: '', type: '' });
    const navigate = useNavigate();
    const videoGridRef = useRef(null);

    const toggleAddFeed = () => setAddFeedOpen(open => !open);

    // Show notification helper
    const showNotification = (message, type = 'info') => {
        setNotification({ show: true, message, type });
        setTimeout(() => {
            setNotification({ show: false, message: '', type: '' });
        }, 3000);
    };

    // Fetch clients for the edit modal
    const fetchClients = async () => {
        try {
            const response = await fetch('http://localhost:8000/api/clients', {
                credentials: 'include'
            });
            if (response.ok) {
                const json = await response.json();
                if (json.success) {
                    setClients(Array.isArray(json.data) ? json.data : []);
                }
            }
        } catch (error) {
            console.error('Error fetching clients:', error);
        }
    };

    // Handle View Details
    const handleViewDetails = (sourceData) => {
        setSelectedSource(sourceData);
        setShowViewDetailsModal(true);
    };

    // Handle Edit
    const handleEdit = (sourceData) => {
        setSelectedSource(sourceData);
        setEditFormData({
            name: sourceData.name || '',
            rtsp_link: sourceData.rtsp_link || '',
            client_id: sourceData.client_id || ''
        });
        setShowEditModal(true);
        // Fetch clients when opening edit modal
        fetchClients();
    };

    // Enhanced validation function
    const validateEditForm = () => {
        const errors = {};

        // Name validation
        if (!editFormData.name.trim()) {
            errors.name = 'Feed name is required';
        } else if (editFormData.name.trim().length < 2) {
            errors.name = 'Feed name must be at least 2 characters long';
        } else if (editFormData.name.trim().length > 50) {
            errors.name = 'Feed name must be less than 50 characters';
        }

        // RTSP URL validation
        if (!editFormData.rtsp_link.trim()) {
            errors.rtsp_link = 'RTSP URL is required';
        } else if (!editFormData.rtsp_link.trim().startsWith('rtsp://')) {
            errors.rtsp_link = 'RTSP URL must start with rtsp://';
        } else if (editFormData.rtsp_link.trim().length < 10) {
            errors.rtsp_link = 'RTSP URL appears to be too short';
        }

        // Client validation
        if (!editFormData.client_id) {
            errors.client_id = 'Client selection is required';
        }

        return errors;
    };

    // Real-time validation for edit form
    const handleEditFormChange = (field, value) => {
        setEditFormData({ ...editFormData, [field]: value });

        // Clear the error for this field when user starts typing
        if (editFormErrors[field]) {
            setEditFormErrors({ ...editFormErrors, [field]: '' });
        }
    };

    // Handle Edit Form Submit
    const handleEditSubmit = async (e) => {
        e.preventDefault();

        // Validate form
        const validationErrors = validateEditForm();
        if (Object.keys(validationErrors).length > 0) {
            setEditFormErrors(validationErrors);
            showNotification(Object.values(validationErrors)[0], 'error');
            return;
        }

        setSubmitting(true);
        try {
            const response = await fetch(`http://localhost:8000/api/sources/${selectedSource.source_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: editFormData.name.trim(),
                    rtsp_link: editFormData.rtsp_link.trim(),
                    client_id: parseInt(editFormData.client_id)
                })
            });

            const result = await response.json();
            if (result.success) {
                showNotification('Video feed updated successfully', 'success');

                // Check if the name changed (which affects the sanitizedName/stream path)
                const oldSanitizedName = selectedSource.sanitizedName;
                const newSanitizedName = editFormData.name.trim()
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, '')
                    .replace(/[^a-z0-9_.-]/g, '');

                const nameChanged = oldSanitizedName !== newSanitizedName;
                if (nameChanged) {
                    // Notify electron/MediaMTX about the stream path change
                    if (window.electron) {
                        window.electron.send("stream-path-changed", {
                            oldPath: oldSanitizedName,
                            newPath: newSanitizedName,
                            sourceId: selectedSource.source_id,
                            rtspUrl: editFormData.rtsp_link.trim()
                        });
                    }
                }

                setData(prevData => {
                    const updatedData = prevData.map(source => {
                        if (source.source_id === selectedSource.source_id) {
                            // Find the client name for the new client_id
                            const newClientName = clients.find(c => c.client_id === parseInt(editFormData.client_id))?.client_name || source.client_name;

                            const updatedSource = {
                                ...source, // Preserve all existing fields
                                name: editFormData.name.trim(),
                                sanitizedName: newSanitizedName,
                                rtsp_link: editFormData.rtsp_link.trim(),
                                client_id: parseInt(editFormData.client_id),
                                client_name: newClientName
                            };

                            return updatedSource;
                        }
                        return source;
                    });
                    
                    return updatedData;
                });

                // If client changed and current filter would hide the edited video, switch to "all"
                const newClientName = clients.find(c => c.client_id === parseInt(editFormData.client_id))?.client_name;
                if (selectedClient !== 'all' && newClientName && selectedClient !== newClientName) {
                    setSelectedClient('all');
                }

                // Clear form errors on successful submit
                setEditFormErrors({});
                setShowEditModal(false);
                setSelectedSource(null);
                setEditFormData({ name: '', rtsp_link: '', client_id: '' });

                // Optionally refresh in background to ensure server sync (without updating UI again)
                const refreshData = async () => {
                    try {
                        const response = await fetch('http://localhost:8000/api/sources', {
                            credentials: 'include'
                        });
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        const json = await response.json();

                        if (json.data && Array.isArray(json.data)) {
                            const serverData = json.data.map(source => ({
                                source_id: source.source_id,
                                name: source.name,
                                sanitizedName: source.name
                                    .toLowerCase()
                                    .trim()
                                    .replace(/\s+/g, '')
                                    .replace(/[^a-z0-9_.-]/g, ''),
                                rtsp_link: source.rtsp_link,
                                client_name: source.client_name,
                                client_id: source.client_id,
                                added_on: source.added_on,
                                map_coordinates: source.map_coordinates
                            }));
                            
                            const editedServerItem = serverData.find(s => s.source_id === selectedSource.source_id);
                            if (editedServerItem && editedServerItem.name === editFormData.name.trim()) {
                                console.log('✅ Server sync confirmed - edit was successful');
                            } else {
                                setData(serverData);
                            }
                        } else {
                            console.warn('⚠️ No valid data received during refresh');
                        }
                    } catch (error) {
                        console.error('❌ Error refreshing data after edit:', error);
                    }
                };
                refreshData();
            } else {
                showNotification(result.error || 'Failed to update video feed', 'error');
            }
        } catch (error) {
            console.error('Error updating video feed:', error);
            showNotification('Network error occurred', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    // Close modals
    const closeViewDetailsModal = () => {
        setShowViewDetailsModal(false);
        setSelectedSource(null);
    };

    const closeEditModal = () => {
        setShowEditModal(false);
        setSelectedSource(null);
        setEditFormData({ name: '', rtsp_link: '', client_id: '' });
        setEditFormErrors({});
        setSubmitting(false);
    };

    useEffect(() => {
        const fetchDataIfNeeded = async () => {
            // If we already have data, don't refresh unless there are no active streams
            if (data && data.length > 0) {
                console.log('🔄 Using existing data - skipping refresh');
                return;
            }

            try {
                const response = await fetch('http://localhost:8000/api/sources', {
                    credentials: 'include'
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const json = await response.json();

                if (json.data && Array.isArray(json.data)) {
                    // Process the sources data to include both name and source_id
                    const processedData = json.data.map(source => ({
                        source_id: source.source_id,
                        name: source.name,
                        sanitizedName: source.name
                            .toLowerCase()
                            .trim()
                            .replace(/\s+/g, '')
                            .replace(/[^a-z0-9_.-]/g, ''),
                        rtsp_link: source.rtsp_link,
                        client_name: source.client_name,
                        client_id: source.client_id,
                        added_on: source.added_on,
                        map_coordinates: source.map_coordinates
                    }));

                    // Only update state if we don't already have data or if the data has changed
                    setData(prevData => {
                        if (!prevData || JSON.stringify(prevData) !== JSON.stringify(processedData)) {
                            console.log('📥 Updating sources data');
                            return processedData;
                        }
                        console.log('🔄 Sources data unchanged');
                        return prevData;
                    });
                } else if (!data) {
                    setData([]);
                }
            } catch (error) {
                console.error('❌ Error fetching sources:', error);
                if (!data) {
                    setData([]);
                }
            }
        };

        fetchDataIfNeeded();
    }, [data, videoStreams.size]);

    // Get unique client names for the filter dropdown - memoized to prevent re-renders
    const uniqueClients = useMemo(() => {
        return data ? [...new Set(data.map(source => source.client_name).filter(Boolean))] : [];
    }, [data]);

    const handleClientFilterChange = useCallback((event) => {
        setSelectedClient(event.target.value);
    }, []);

    // Memoize the filtered data to prevent unnecessary re-renders
    const filteredData = useMemo(() => {
        return data ? (
            selectedClient === 'all'
                ? data
                : data.filter(source => source.client_name === selectedClient)
        ) : [];
    }, [data, selectedClient]);

    // Memoize the sortable instance to prevent recreation on filter changes
    const sortableInstanceRef = useRef(null);

    useEffect(() => {
        if (videoGridRef.current && !sortableInstanceRef.current) {
            // Create sortable instance only once
            sortableInstanceRef.current = Sortable.create(videoGridRef.current, {
                animation: 150,
                ghostClass: "sortable-ghost",
                onEnd: (evt) => {
                    // Work with the current filtered data
                    const currentFilteredData = [...filteredData];
                    const [draggedItem] = currentFilteredData.splice(evt.oldIndex, 1);
                    currentFilteredData.splice(evt.newIndex, 0, draggedItem);

                    // Update the main data array with the new order
                    setData(prevData => {
                        const updatedData = [...prevData];

                        // If we're filtering, we need to update the order within the filter
                        if (selectedClient !== 'all') {
                            // For filtered view, we just swap positions in the main array
                            const draggedItemIndex = updatedData.findIndex(item => item.source_id === draggedItem.source_id);
                            const targetItem = currentFilteredData[evt.newIndex === 0 ? 0 : evt.newIndex - 1];
                            const targetItemIndex = updatedData.findIndex(item => item.source_id === targetItem?.source_id);

                            if (draggedItemIndex !== -1 && targetItemIndex !== -1) {
                                // Remove dragged item and insert at new position
                                const [removed] = updatedData.splice(draggedItemIndex, 1);
                                const insertIndex = targetItemIndex + (evt.newIndex > evt.oldIndex ? 1 : 0);
                                updatedData.splice(insertIndex, 0, removed);
                            }
                        } else {
                            // For "all" view, simple reorder
                            const [removed] = updatedData.splice(evt.oldIndex, 1);
                            updatedData.splice(evt.newIndex, 0, removed);
                        }

                        return updatedData;
                    });

                    // Send swap order to backend
                    const droppedSource = draggedItem;
                    const swappedWith = currentFilteredData[evt.newIndex === 0 ? 1 : evt.newIndex - 1];

                    if (window.electron && swappedWith) {
                        window.electron.send("swap-stream-order", {
                            a: droppedSource.sanitizedName,
                            b: swappedWith.sanitizedName
                        });
                    }
                }
            });
        }

        return () => {
            if (sortableInstanceRef.current) {
                sortableInstanceRef.current.destroy();
                sortableInstanceRef.current = null;
            }
        };
    }, [filteredData]); // Empty dependency array - create only once

    const handleVideoCellClick = useCallback((clientName) => {
        navigate(`/video/${clientName}`);
    }, [navigate]);

    const handleVideoDelete = useCallback((deletedSourceId, sourceName) => {
        console.log(`🗑️ Removing video with ID ${deletedSourceId} from UI state`);
        setData(prevData => prevData.filter(source => source.source_id !== deletedSourceId));
        showNotification(`Video feed "${sourceName || 'Unknown'}" deleted successfully`, 'success');
    }, []);

    const handleVideoAdd = useCallback((newSource) => {
        console.log(`➕ Adding new video to UI state:`, newSource);
        const processedSource = {
            source_id: newSource.source_id,
            name: newSource.name,
            sanitizedName: newSource.name
                .toLowerCase()
                .trim()
                .replace(/\s+/g, '')
                .replace(/[^a-z0-9_.-]/g, ''),
            rtsp_link: newSource.rtsp_link,
            client_name: newSource.client_name
        };
        setData(prevData => [...prevData, processedSource]);

        if (selectedClient !== 'all' && processedSource.client_name !== selectedClient) {
            setSelectedClient('all');
        }

        // Show success notification
        showNotification(`Video feed "${newSource.name}" added successfully`, 'success');
    }, [selectedClient]);

    return (
        <>
            <div className="top-navigation">
                <div className="left">
                    <select
                        id="client-filter"
                        className="client-filter-select"
                        value={selectedClient}
                        onChange={handleClientFilterChange}
                    >
                        <option value="all">All Clients</option>
                        {uniqueClients.map(client => (
                            <option key={client} value={client}>
                                {client}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="right">
                    <a onClick={toggleAddFeed} id="add-new-feed-btn" href="#"><i class="fa-solid fa-laptop-medical"></i></a>
                </div>
            </div>

            <div id="video-grid" ref={videoGridRef}>
                {filteredData.map(source => {
                    const clientKey = source.client_name.toLowerCase().replace(/\s+/g, '');
                    const streamPath = `${clientKey}/${source.sanitizedName}`;
                    const isStreamActive = videoStreams.has(streamPath);

                    return (
                        <VideoCell
                            key={`${source.source_id}-${streamPath}`}
                            id={source.source_id}
                            name={source.name}
                            clientName={source.client_name}
                            path={`${streamPath}`}
                            onClick={handleVideoCellClick}
                            onDelete={handleVideoDelete}
                            onEdit={handleEdit}
                            onViewDetails={handleViewDetails}
                            sourceData={source}
                            isVisible={true}
                            // Force reuse of existing stream connection and preserve connection
                            initialState={isStreamActive ? 'connected' : 'connecting'}
                            preserveConnection={true}
                        />
                    )
                })}
            </div>

            {addFeedOpen && (
                <AddNewFeed onAddFeedToggle={toggleAddFeed} onVideoAdd={handleVideoAdd} />
            )}

            {/* Notification */}
            {notification.show && (
                <div className={`notification ${notification.type}`}>
                    {notification.message}
                </div>
            )}

            {/* View Details Modal */}
            {showViewDetailsModal && selectedSource && (
                <Modal isOpen={showViewDetailsModal} onClose={closeViewDetailsModal}>
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3>Video Feed Details</h3>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gap: '15px' }}>
                                <div>
                                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#4a9eff' }}>
                                        Feed Name:
                                    </label>
                                    <div style={{ padding: '8px', backgroundColor: '#3a3a3a', borderRadius: '4px', border: '1px solid #555' }}>
                                        {selectedSource.name}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#4a9eff' }}>
                                        Client:
                                    </label>
                                    <div style={{ padding: '8px', backgroundColor: '#3a3a3a', borderRadius: '4px', border: '1px solid #555' }}>
                                        {selectedSource.client_name}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#4a9eff' }}>
                                        RTSP URL:
                                    </label>
                                    <div style={{ padding: '8px', backgroundColor: '#3a3a3a', borderRadius: '4px', border: '1px solid #555', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.9em' }}>
                                        {selectedSource.rtsp_link}
                                    </div>
                                </div>
                                {selectedSource.added_on && (
                                    <div>
                                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#4a9eff' }}>
                                            Added On:
                                        </label>
                                        <div style={{ padding: '8px', backgroundColor: '#3a3a3a', borderRadius: '4px', border: '1px solid #555' }}>
                                            {new Date(selectedSource.added_on).toLocaleString()}
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#4a9eff' }}>
                                        Status:
                                    </label>
                                    <div style={{ padding: '8px', backgroundColor: '#3a3a3a', borderRadius: '4px', border: '1px solid #555' }}>
                                        <span style={{ color: '#4CAF50', fontWeight: 'bold' }}>● Active</span>
                                        <span style={{ marginLeft: '10px', color: '#888', fontSize: '0.9em' }}>
                                            (Stream is currently being processed)
                                        </span>
                                    </div>
                                </div>
                                {selectedSource.map_coordinates && (
                                    <div>
                                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#4a9eff' }}>
                                            Map Coordinates:
                                        </label>
                                        <div style={{ padding: '8px', backgroundColor: '#3a3a3a', borderRadius: '4px', border: '1px solid #555' }}>
                                            {selectedSource.map_coordinates}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => {
                                    closeViewDetailsModal();
                                    handleEdit(selectedSource);
                                }}
                                style={{ marginRight: '10px' }}
                            >
                                Edit Feed
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={closeViewDetailsModal}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Edit Modal */}
            {showEditModal && selectedSource && (
                <Modal isOpen={showEditModal} onClose={closeEditModal}>
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3>Edit Video Feed</h3>
                        </div>
                        <form onSubmit={handleEditSubmit}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label className="form-label">
                                        Feed Name *
                                    </label>
                                    <input
                                        type="text"
                                        className={`form-input ${editFormErrors.name ? 'error' : ''}`}
                                        value={editFormData.name}
                                        onChange={(e) => handleEditFormChange('name', e.target.value)}
                                        disabled={submitting}
                                        required
                                        placeholder="Enter feed name"
                                        autoFocus
                                    />
                                    {editFormErrors.name && (
                                        <div style={{ color: '#ff6b6b', fontSize: '0.85em', marginTop: '5px' }}>
                                            {editFormErrors.name}
                                        </div>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label className="form-label">
                                        RTSP URL *
                                    </label>
                                    <input
                                        type="text"
                                        className={`form-input ${editFormErrors.rtsp_link ? 'error' : ''}`}
                                        value={editFormData.rtsp_link}
                                        onChange={(e) => handleEditFormChange('rtsp_link', e.target.value)}
                                        disabled={submitting}
                                        required
                                        placeholder="rtsp://..."
                                        style={{ fontFamily: 'monospace' }}
                                    />
                                    {editFormErrors.rtsp_link && (
                                        <div style={{ color: '#ff6b6b', fontSize: '0.85em', marginTop: '5px' }}>
                                            {editFormErrors.rtsp_link}
                                        </div>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label className="form-label">
                                        Client *
                                    </label>
                                    <select
                                        className={`form-input ${editFormErrors.client_id ? 'error' : ''}`}
                                        value={editFormData.client_id}
                                        onChange={(e) => handleEditFormChange('client_id', e.target.value)}
                                        disabled={submitting}
                                        required
                                    >
                                        <option value="">Select a client</option>
                                        {clients.map((client) => (
                                            <option key={client.client_id} value={client.client_id}>
                                                {client.client_name}
                                            </option>
                                        ))}
                                    </select>
                                    {editFormErrors.client_id && (
                                        <div style={{ color: '#ff6b6b', fontSize: '0.85em', marginTop: '5px' }}>
                                            {editFormErrors.client_id}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={closeEditModal}
                                    disabled={submitting}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-success"
                                    disabled={submitting}
                                >
                                    {submitting ? 'Updating...' : 'Update Feed'}
                                </button>
                            </div>
                        </form>
                    </div>
                </Modal>
            )}

        </>
    );
}