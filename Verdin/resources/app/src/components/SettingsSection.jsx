// SettingsSection.jsx
import React, { forwardRef, useState, useEffect } from 'react';

const SettingsSection = forwardRef(({ onClose, onLogout }, ref) => {
  const [username, setUsername] = useState('Loading...');
  const [originalUsername, setOriginalUsername] = useState(''); // Store original username
  const [editedUsername, setEditedUsername] = useState(''); // Track edited username
  const [loading, setLoading] = useState(true);
    // Password change form state
  const [passwordForm, setPasswordForm] = useState({
    oldPassword: '',
    newPassword: '',
    verifyPassword: ''
  });
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Fetch user data when component mounts
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/user/login/status', {
          credentials: 'include',
        });        if (res.ok) {
          const data = await res.json();
          if (data.status && data.user && data.user.username) {
            setUsername(data.user.username);
            setOriginalUsername(data.user.username);
            setEditedUsername(data.user.username);
          } else {
            setUsername('Unknown User');
            setOriginalUsername('Unknown User');
            setEditedUsername('Unknown User');
          }
        } else {
          setUsername('Error loading user');
          setOriginalUsername('Error loading user');
          setEditedUsername('Error loading user');
        }
      } catch (err) {
        console.error('Error fetching user data:', err);
        setUsername('Error loading user');
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);
  // Handle password form input changes
  const handlePasswordInputChange = (e) => {
    const { name, value } = e.target;
    setPasswordForm(prev => ({
      ...prev,
      [name]: value
    }));
  };  // Helper function to show notifications
  const showNotification = async (title, body, type = 'info') => {
    try {
      await fetch('http://localhost:8000/api/notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ title, body, type })
      });
    } catch (err) {
      console.error('Failed to show notification:', err);
    }
  };

  // Handle password change form submission
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    
    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.verifyPassword) {
      await showNotification('Validation Error', 'Please fill all password fields', 'error');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.verifyPassword) {
      await showNotification('Validation Error', 'New passwords do not match', 'error');
      return;
    }

    setPasswordLoading(true);

    try {
      const res = await fetch('http://localhost:8000/api/user/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          oldPassword: passwordForm.oldPassword,
          newPassword: passwordForm.newPassword,
          verifyPassword: passwordForm.verifyPassword
        })
      });

      const data = await res.json();

      if (data.success) {
        // Clear form on success - notification will be shown by the backend
        setPasswordForm({
          oldPassword: '',
          newPassword: '',
          verifyPassword: ''
        });
      }
      // Error notifications are handled by the backend
    } catch (err) {
      console.error('Password change error:', err);
      await showNotification('Network Error', 'Failed to connect to server. Please try again.', 'error');
    } finally {
      setPasswordLoading(false);
    }
  };
  // Username editing handlers
  const handleUsernameKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleUsernameUpdate();
    } else if (e.key === 'Escape') {
      // Revert to original username on Escape
      setEditedUsername(originalUsername);
      e.target.textContent = originalUsername;
      e.target.blur();
    }
  };

  const handleUsernameBlur = (e) => {
    // Revert to original username if user unfocuses without pressing Enter
    const currentText = e.target.textContent.trim();
    if (currentText !== originalUsername) {
      setEditedUsername(originalUsername);
      e.target.textContent = originalUsername;
    }
  };

  const handleUsernameInput = (e) => {
    // Track the edited username as user types
    setEditedUsername(e.target.textContent);
  };

  const handleUsernameUpdate = async () => {
    const trimmedUsername = editedUsername.trim();
    
    if (!trimmedUsername) {
      await showNotification('Validation Error', 'Username cannot be empty', 'error');
      // Revert to original
      const element = document.getElementById('username-input');
      setEditedUsername(originalUsername);
      element.textContent = originalUsername;
      element.blur();
      return;
    }

    if (trimmedUsername === originalUsername) {
      // No change, just unfocus
      document.getElementById('username-input').blur();
      return;
    }

    try {
      const res = await fetch('http://localhost:8000/api/user/update-username', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ newUsername: trimmedUsername })
      });

      const data = await res.json();

      if (data.success) {
        // Update all username states with the new username
        setUsername(data.newUsername);
        setOriginalUsername(data.newUsername);
        setEditedUsername(data.newUsername);
        // Unfocus the element
        const element = document.getElementById('username-input');
        element.textContent = data.newUsername;
        element.blur();
      } else {
        // Revert on error
        const element = document.getElementById('username-input');
        setEditedUsername(originalUsername);
        element.textContent = originalUsername;
        element.blur();
      }
    } catch (err) {
      console.error('Username update error:', err);
      await showNotification('Network Error', 'Failed to connect to server. Please try again.', 'error');
      // Revert on error
      const element = document.getElementById('username-input');
      setEditedUsername(originalUsername);
      element.textContent = originalUsername;
      element.blur();
    }
  };

  const handleLogout = async e => {
    e.preventDefault();

    try {
      const res = await fetch('http://localhost:8000/api/user/logout', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();
      if (data.success) {
        onLogout();
      } else {
        console.error('Logout failed:', data.message);
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <div
      ref={ref}
      id="settings-section"
      className="flex text-white h-full fixed inset-0 bg-black bg-opacity-50 z-50"
    >
      <div className="menu bg-gray-700 p-4 flex flex-col justify-between w-48 rounded-l-lg">
        <div className="top flex flex-col">
          <a
            href="#"
            className="flex items-center p-2 rounded-md hover:bg-gray-600 transition-colors text-white text-lg mb-2"
          >
            <i className="fa-solid fa-gear mr-2"></i> General
          </a>
          <a
            href="#"
            className="flex items-center p-2 rounded-md bg-indigo-600 text-white text-lg mb-2"
          >
            <i className="fa-solid fa-address-card mr-2"></i> Account
          </a>
        </div>
        <div className="bottom mt-auto">
          <a
            href="#"
            onClick={handleLogout}
            id="logout-btn"
            title="Logout"
            className="flex items-center p-2 rounded-md hover:bg-gray-600 transition-colors text-white text-lg"
          >
            <i className="fa-solid fa-arrow-right-from-bracket mr-2"></i> Logout
          </a>
        </div>
      </div>

      <div className="details p-6 flex-grow bg-gray-800 rounded-r-lg">        <label htmlFor="username-input" className="block text-gray-400 text-sm mb-1">
          Username
        </label>
        <p
          id="username-input"
          contentEditable="true"
          className="bg-gray-700 p-2 rounded-md mb-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-200 hover:bg-gray-600"
          onKeyDown={handleUsernameKeyDown}
          onBlur={handleUsernameBlur}
          onInput={handleUsernameInput}
          suppressContentEditableWarning={true}
          title="Click to edit username. Press Enter to save or Escape to cancel."
        >
          {username}
        </p><hr className="border-gray-600 my-4" />
        
        <form onSubmit={handlePasswordChange}>
          <label htmlFor="old_pass" className="block text-gray-400 text-sm mb-1">
            Old Password
          </label>
          <input
            type="password"
            id="old_pass"
            name="oldPassword"
            value={passwordForm.oldPassword}
            onChange={handlePasswordInputChange}
            placeholder="●●●●●●●●●●●●●●"
            className="w-full p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:border-indigo-500 focus:ring focus:ring-indigo-500 focus:ring-opacity-50 mb-4"
            disabled={passwordLoading}
          />
          <label htmlFor="new_pass" className="block text-gray-400 text-sm mb-1">
            New Password
          </label>
          <input
            type="password"
            id="new_pass"
            name="newPassword"
            value={passwordForm.newPassword}
            onChange={handlePasswordInputChange}
            placeholder="●●●●●●●●●●●●●●"
            className="w-full p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:border-indigo-500 focus:ring focus:ring-indigo-500 focus:ring-opacity-50 mb-4"
            disabled={passwordLoading}
          />
          <label htmlFor="verify_pass" className="block text-gray-400 text-sm mb-1">
            Verify New Password
          </label>
          <input
            type="password"
            id="verify_pass"
            name="verifyPassword"
            value={passwordForm.verifyPassword}
            onChange={handlePasswordInputChange}
            placeholder="●●●●●●●●●●●●●●"
            className="w-full p-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:border-indigo-500 focus:ring focus:ring-indigo-500 focus:ring-opacity-50 mb-6"
            disabled={passwordLoading}
          />
          <button
            type="submit"
            id="change-password-btn"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md transition-colors w-full disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={passwordLoading}
          >
            {passwordLoading ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
});

export default SettingsSection;
