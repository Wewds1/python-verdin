// Safe way to expose APIs to the renderer
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong', 
  motionDetection: {
      start: () => ipcRenderer.invoke('start-python-motion'),
      stop: () => ipcRenderer.invoke('stop-python-motion'),
      getStatus: () => ipcRenderer.invoke('get-motion-status'),
      syncCameras: () => ipcRenderer.invoke('sync-motion-cameras')
  },
  
  // Alternative simple access (if you prefer):
  startMotionDetection: () => ipcRenderer.invoke('start-python-motion'),
  stopMotionDetection: () => ipcRenderer.invoke('stop-python-motion'),
  getMotionStatus: () => ipcRenderer.invoke('get-motion-status')
});
