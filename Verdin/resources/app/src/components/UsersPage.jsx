import React, { useState, useEffect } from 'react';
import Modal from './Modal';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ 
    username: '', 
    password: '', 
    confirm_pass: '', 
    user_level: 'user' 
  });
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState({ show: false, message: '', type: '' });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState(null);

  // Fetch users from API
  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('http://localhost:8000/api/users', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const json = await response.json();
      if (json.success) {
        setUsers(Array.isArray(json.data) ? json.data : []);
      } else {
        setError('Failed to fetch users');
        setUsers([]);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      setError('Failed to fetch users: ' + error.message);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
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
    if (!formData.username.trim()) {
      showNotification('Username is required', 'error');
      return;
    }

    // For new users, password is required
    if (!editingUser && !formData.password.trim()) {
      showNotification('Password is required', 'error');
      return;
    }

    // For new users, confirm password
    if (!editingUser && formData.password !== formData.confirm_pass) {
      showNotification('Passwords do not match', 'error');
      return;
    }

    setSubmitting(true);
    try {
      let response;      if (editingUser) {
        // Update existing user (only username and user_level)
        response = await fetch(`http://localhost:8000/api/users/${editingUser.user_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            username: formData.username,
            user_level: formData.user_level
          })
        });
      } else {
        // Add new user
        response = await fetch('http://localhost:8000/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(formData)
        });
      }

      const result = await response.json();
      if (result.success) {
        await fetchUsers(); // Refresh the list
        handleCloseModal();
        showNotification(editingUser ? 'User updated successfully' : 'User added successfully', 'success');
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

  // Handle delete user
  const handleDelete = (user) => {
    setUserToDelete(user);
    setShowConfirmDialog(true);
  };

  // Confirm delete user
  const confirmDelete = async () => {
    if (!userToDelete) return;

    try {
      const response = await fetch(`http://localhost:8000/api/users/${userToDelete.user_id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const result = await response.json();
      if (result.success) {
        await fetchUsers(); // Refresh the list
        showNotification('User deleted successfully', 'success');
      } else {
        showNotification(result.error || 'Failed to delete user', 'error');
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      showNotification('Network error occurred', 'error');
    } finally {
      setShowConfirmDialog(false);
      setUserToDelete(null);
    }
  };

  // Cancel delete
  const cancelDelete = () => {
    setShowConfirmDialog(false);
    setUserToDelete(null);
  };

  // Open modal for adding new user
  const handleAddNew = () => {
    setEditingUser(null);
    setFormData({ username: '', password: '', confirm_pass: '', user_level: 'user' });
    setShowModal(true);
  };

  // Open modal for editing user
  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({ 
      username: user.username, 
      password: '', 
      confirm_pass: '', 
      user_level: user.user_level 
    });
    setShowModal(true);
  };

  // Close modal
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingUser(null);
    setFormData({ username: '', password: '', confirm_pass: '', user_level: 'user' });
  };

  if (loading) {
    return (
      <div id="users-container">
        <div className="loading-state">
          <h3>Loading users...</h3>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div id="users-container">
        <div className="error-state">
          <div className="error-message">Error: {error}</div>
          <button className="btn btn-primary" onClick={fetchUsers}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="users-container">
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
      
      <div id="users-header">
        <h2>Users Management</h2>
        <button 
          className="btn btn-success" 
          onClick={handleAddNew}
          type="button"
        >
          + Add New User
        </button>
      </div>

      {users.length === 0 ? (
        <div className="empty-state">
          <h3>No users found</h3>
          <p>Get started by adding your first user</p>
          <button 
            className="btn btn-primary" 
            onClick={handleAddNew}
            type="button"
          >
            Add Your First User
          </button>
        </div>
      ) : (
        <table className="users-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Username</th>
              <th>User Level</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.user_id}>
                <td>{user.user_id}</td>
                <td>{user.username}</td>
                <td>
                  <span className={`user-level-badge ${user.user_level === 'admin' ? 'user-level-admin' : 'user-level-user'}`}>
                    {user.user_level}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button 
                      className="btn btn-primary"
                      onClick={() => handleEdit(user)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button 
                      className="btn btn-danger"
                      onClick={() => handleDelete(user)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      
      {/* Add/Edit Modal */}
      {showModal && (
        <Modal isOpen={showModal} onClose={handleCloseModal}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editingUser ? 'Edit User' : 'Add New User'}</h3>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">
                    Username *
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                    placeholder="Enter username"
                    autoFocus
                  />
                </div>

                {!editingUser && (
                  <>
                    <div className="form-group">
                      <label className="form-label">
                        Password *
                      </label>
                      <input
                        type="password"
                        className="form-input"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        required
                        placeholder="Enter password"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        Confirm Password *
                      </label>
                      <input
                        type="password"
                        className="form-input"
                        value={formData.confirm_pass}
                        onChange={(e) => setFormData({ ...formData, confirm_pass: e.target.value })}
                        required
                        placeholder="Confirm password"
                      />
                    </div>
                  </>
                )}

                <div className="form-group">
                  <label className="form-label">
                    User Level *
                  </label>
                  <select
                    className="form-input"
                    value={formData.user_level}
                    onChange={(e) => setFormData({ ...formData, user_level: e.target.value })}
                    required
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
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
                  {submitting ? 'Saving...' : (editingUser ? 'Update' : 'Add')}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
      
      {/* Confirmation Dialog */}
      {showConfirmDialog && userToDelete && (
        <Modal isOpen={showConfirmDialog} onClose={cancelDelete}>
          <div className="modal-content">
            <div className="modal-header">
              <h3>Confirm Delete</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete user "{userToDelete.username}"?</p>
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
