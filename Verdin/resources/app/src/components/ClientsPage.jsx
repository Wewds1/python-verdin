import React, { useState, useEffect } from 'react';
import Modal from './Modal';

export default function ClientsPage() {  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [formData, setFormData] = useState({ client_name: '' });
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);

  // Fetch clients from API
  const fetchClients = async () => {
    try {
      setLoading(true);
      setError(null);
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
        setError('Failed to fetch clients');
        setClients([]);
      }
    } catch (error) {
      console.error('Error fetching clients:', error);
      setError('Failed to fetch clients: ' + error.message);
      setClients([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);
  // Show notification helper
  const showNotification = (message, type = 'info') => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification({ show: false, message: '', type: '' });
    }, 3000);
  };

  // Handle form submission for add/edit
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.client_name.trim()) {
      showNotification('Client name is required', 'error');
      return;
    }

    setSubmitting(true);
    try {
      let response;      if (editingClient) {
        // Update existing client
        response = await fetch(`http://localhost:8000/api/clients/${editingClient.client_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(formData)
        });
      } else {
        // Add new client
        response = await fetch('http://localhost:8000/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(formData)
        });
      }

      const result = await response.json();
      if (result.success) {
        await fetchClients(); // Refresh the list
        handleCloseModal();
        showNotification(editingClient ? 'Client updated successfully' : 'Client added successfully', 'success');
      } else {
        showNotification(result.error || 'Operation failed', 'error');
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      showNotification('Network error occurred', 'error');
    } finally {
      setSubmitting(false);
    }
  };
  // Handle delete client
  const handleDelete = (client) => {
    setClientToDelete(client);
    setShowConfirmDialog(true);
  };

  // Confirm delete client
  const confirmDelete = async () => {
    if (!clientToDelete) return;

    try {
      const response = await fetch(`http://localhost:8000/api/clients/${clientToDelete.client_id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const result = await response.json();
      if (result.success) {
        await fetchClients(); // Refresh the list
        showNotification('Client deleted successfully', 'success');
      } else {
        showNotification(result.error || 'Failed to delete client', 'error');
      }
    } catch (error) {
      console.error('Error deleting client:', error);
      showNotification('Network error occurred', 'error');
    } finally {
      setShowConfirmDialog(false);
      setClientToDelete(null);
    }
  };

  // Cancel delete
  const cancelDelete = () => {
    setShowConfirmDialog(false);
    setClientToDelete(null);
  };// Open modal for adding new client
  const handleAddNew = () => {
    setEditingClient(null);
    setFormData({ client_name: '' });
    setShowModal(true);
  };

  // Open modal for editing client
  const handleEdit = (client) => {
    setEditingClient(client);
    setFormData({ client_name: client.client_name });
    setShowModal(true);
  };

  // Close modal
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingClient(null);
    setFormData({ client_name: '' });
  };

  if (loading) {
    return (
      <div id="clients-container">
        <div className="loading-state">
          <h3>Loading clients...</h3>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div id="clients-container">
        <div className="error-state">
          <div className="error-message">Error: {error}</div>
          <button className="btn btn-primary" onClick={fetchClients}>
            Retry
          </button>
        </div>
      </div>
    );
  }  return (
    <div id="clients-container">
      {/* Notification */}
      {notification.show && (
        <div 
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '4px',
            color: 'white',
            backgroundColor: notification.type === 'success' ? '#28a745' : notification.type === 'error' ? '#dc3545' : '#007bff',
            zIndex: 10000,
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
          }}
        >
          {notification.message}
        </div>
      )}
      
      <div id="clients-header">
        <h2>Clients Management</h2>
        <button 
          className="btn btn-success" 
          onClick={handleAddNew}
          type="button"
        >
          + Add New Client
        </button>
      </div>{clients.length === 0 ? (
        <div className="empty-state">
          <h3>No clients found</h3>
          <p>Get started by adding your first client</p>
          <button 
            className="btn btn-primary" 
            onClick={handleAddNew}
            type="button"
          >
            Add Your First Client
          </button>
        </div>
      ) : (
        <table className="clients-table">
          <thead>
            <tr>
              <th>Client ID</th>
              <th>Client Name</th>
              <th>Camera Count</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.client_id}>
                <td>{client.client_id}</td>
                <td>{client.client_name}</td>
                <td>
                  <span className={`camera-count-badge ${client.camera_count > 0 ? 'camera-count-active' : 'camera-count-inactive'}`}>
                    {client.camera_count} cameras
                  </span>
                </td>
                <td>                  <div className="action-buttons">
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleEdit(client)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button 
                      className="btn btn-danger"
                      onClick={() => handleDelete(client)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>            ))}
          </tbody>
        </table>
      )}
      
      {/* Add/Edit Modal */}
      {showModal && (
        <Modal isOpen={showModal} onClose={handleCloseModal}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editingClient ? 'Edit Client' : 'Add New Client'}</h3>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">
                    Client Name *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.client_name}
                    onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                    required
                    placeholder="Enter client name"
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseModal}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-success"
                  disabled={submitting}
                >
                  {submitting ? 'Saving...' : (editingClient ? 'Update' : 'Add')}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
      
      {/* Confirmation Dialog */}
      {showConfirmDialog && clientToDelete && (
        <Modal isOpen={showConfirmDialog} onClose={cancelDelete}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Confirm Delete</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete "{clientToDelete.client_name}"?</p>
              {clientToDelete.camera_count > 0 && (
                <p style={{ color: '#ffc107', marginTop: '10px' }}>
                  <strong>Warning:</strong> This will also affect {clientToDelete.camera_count} cameras.
                </p>
              )}
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
