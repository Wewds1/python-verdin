import React, { useState, useEffect } from 'react';
import {
  HashRouter as Router,
  Routes,
  Route,
  useLocation
} from 'react-router-dom';
import { VideoStreamProvider } from '../context/VideoStreamContext';
import SideNavigation from './SideNavigation';
import LiveFeedsPage from './LiveFeedsPage';
import ResourceMonitoringPage from './ResourceMonitoringPage';
import SettingsSection from './SettingsSection';
import ExpandedVideoPage from './ExpandedVideoPage';
import LogsPage from './LogsPage';
import LoginPage from './LoginPage';
import ClientsPage from './ClientsPage';
import UsersPage from './UsersPage';
import MessagesPage from './MessagesPage';
import MotionDetectionWidget from './MotionDetectionWidget';
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('http://localhost:8000/api/user/login/status', {
          credentials: 'include'
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get('Content-Type') || '';
        if (!contentType.includes('application/json')) throw new Error('Expected JSON');

        const data = await res.json();
        setIsAuthenticated(Boolean(data.status));
      } catch {
        setIsAuthenticated(false);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  if (authLoading) {
    return <div id="login-loading">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <VideoStreamProvider>
      <Router>
        <AppContent onLogout={() => setIsAuthenticated(false)} />
      </Router>
    </VideoStreamProvider>
  );
}

function AppContent({ onLogout }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = React.useRef(null);
  const location = useLocation();
  const onLiveRoute = location.pathname === '/';

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        settingsOpen &&
        settingsRef.current &&
        !settingsRef.current.contains(event.target)
      ) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [settingsOpen]);

  return (
    <>
      <SideNavigation onSettingsToggle={() => setSettingsOpen(o => !o)} />

      <div id="content-area" style={{ position: 'relative', height: '100%' }}>
        <div
          id="live-feeds-wrapper"
          style={{
            display: onLiveRoute ? 'block' : 'none',
            height: '100%',
            width: '100%',
            position: 'absolute',
            inset: 0
          }}
        >
          <LiveFeedsPage isVisible={onLiveRoute} />
        </div>
            <div className='app'>
              <MotionDetectionWidget />
            </div>
        <div
          id="resource-monitoring-wrapper"
          style={{
            display: location.pathname === '/resource-monitoring' ? 'block' : 'none',
            height: '100%',
            width: '100%',
            position: 'absolute',
            inset: 0
          }}
        >
          <ResourceMonitoringPage isVisible={location.pathname === '/resource-monitoring'} />
        </div>
        
        <div style={{ 
          display: !onLiveRoute && location.pathname !== '/resource-monitoring' ? 'block' : 'none',
          height: '100%'
        }}>
          <Routes>
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route
              path="/video/:clientName/:videoName"
              element={<ExpandedVideoPage />}
            />
            <Route path="/system-logs" element={<LogsPage />} />
          </Routes>
        </div>
      </div>

      {settingsOpen && (
        <SettingsSection
          ref={settingsRef}
          onClose={() => setSettingsOpen(false)}
          onLogout={() => {
            setSettingsOpen(false);
            onLogout();
          }}
        />
      )}
    </>
  );
}

export default App;
