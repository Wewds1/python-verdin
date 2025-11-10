const { app: electronApp, BrowserWindow, dialog, Notification, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const si = require('systeminformation');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const http = require('http');
require('dotenv').config();
const { addCamera, removeCamera, getAllSources, addSource, getClients, deleteSource } = require('./modules/sources.js');
const { getAllLogs } = require('./modules/logs.js');
const { getAllClients, addClient, deleteClient, updateClient } = require('./modules/clients.js');
const { getAllUsers, addUser, deleteUser, updateUser } = require('./modules/user.js');
const db = require('./model/db');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const apiApp = express();
const cors = require('cors');
const { authenticateUser, updatePassword, updateUsername } = require('./modules/user.js');
const sources = require('./modules/sources.js');
apiApp.use(express.json());


const appRoot = electronApp.isPackaged ? path.join(process.resourcesPath, 'app', 'electron') : path.join(__dirname);
const ffmpegPath = path.join(appRoot, 'ffmpeg', 'ffmpeg.exe');

const API_PORT = 8000;
let win;

apiApp.listen(API_PORT, () => {
  console.log(`📡 Express API running at http://localhost:${API_PORT}`);
});

let mediaServerProcess = null;
const serverPath = path.join(__dirname, 'mediamtx.exe');
// const configPath = path.join(__dirname, 'mediamtx.yml');



// Helper function to show Windows notifications
function showNotification(title, body, type = 'info') {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      icon: path.join(__dirname, '../assets/icon.ico'),
      silent: false,
      timeoutType: 'default'
    });

    notification.show();

    notification.on('click', () => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
  }
}

// APIs

// Create sessions directory if it doesn't exist
const sessionsDir = path.join(__dirname, '../sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

apiApp.use(cors({
  origin: [`http://localhost:${API_PORT}`, 'http://localhost:5173', 'http://10.10.10.77:8000', 'http://10.10.10.66:8000'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With'],
  exposedHeaders: ['Set-Cookie']
}));

// Serve static files from the dist folder
apiApp.use(express.static(path.join(__dirname, '../dist')));

apiApp.use(session({
  store: new FileStore({
    path: path.join(__dirname, '../sessions'),
    ttl: 86400, // 24 hours in seconds
    retries: 5,
    factor: 1,
    minTimeout: 50,
    maxTimeout: 100
  }),
  secret: '7111fd7224964bbd0c0456eb728a5154f9b279298c98dec55f9071970a17f6d3',
  resave: false, // Don't save session if unmodified
  saveUninitialized: true, // Create session even if nothing stored - needed for Electron
  rolling: true, // Reset expiration on each request
  name: 'verdin_session', // Custom session name
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    httpOnly: false, // Allow client-side access for Electron
    secure: false, // HTTP (not HTTPS)
    sameSite: 'lax' // Same origin, so lax is fine
  }
}));


// User end-points

apiApp.post('/api/user/login', async (req, res) => {
  const { username, password } = req.body;
  req.session.loggedIn = false;

  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, error: 'Please provide your user credentials!' });
  }

  try {
    const result = await authenticateUser(username, password);

    if (result.status !== 'login-success') {
      return req.session.destroy(err => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Error clearing session' });
        }

        return res.json({ success: false, message: result.message });
      });
    }
    
    req.session.user = result.data;
    req.session.loggedIn = true;

    return req.session.save(err => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Session save failed' });
      }
      
      win.setSize(1366, 900, true);
      win.center();
      win.restore();
      return res.json({ success: true, data: req.session.user });
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

apiApp.post('/api/user/logout', (req, res) => {
  console.log('Logout attempt for session:', req.session.id);

  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }

    win.setSize(450, 400, true);
    win.center();
    win.restore();

    // Clear all possible cookie variations
    res.clearCookie('verdin_session', { path: '/' });
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ success: true });
  });
});

apiApp.get('/api/user/login/status', async (req, res) => {

  // Ensure session is properly saved
  if (req.session.loggedIn && req.session.user) {
    req.session.save((err) => {
      if (err) {
        console.error('Session save error in status check:', err);
      }
    });

    win.setSize(1366, 900, true);
    win.center();
    win.restore();
  }

  const response = {
    status: req.session.loggedIn || false,
    user: req.session.user || null
  };

  res.json(response);
});

apiApp.post('/api/user/change-password', async (req, res) => {
  if (!req.session.loggedIn || !req.session.user) {
    showNotification('Authentication Error', 'User not authenticated', 'error');
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const { oldPassword, newPassword, verifyPassword } = req.body;

  if (!oldPassword || !newPassword || !verifyPassword) {
    showNotification('Validation Error', 'Please provide all required fields', 'error');
    return res.status(400).json({ success: false, message: 'Please provide all required fields' });
  }

  try {
    const result = await updatePassword(oldPassword, newPassword, verifyPassword, req.session.user.user_id);

    if (result.status === 'success') {
      showNotification('Password Changed', 'Your password has been updated successfully!', 'success');
      return res.json({ success: true, message: result.message });
    } else {
      showNotification('Password Change Failed', result.message, 'error');
      return res.status(400).json({ success: false, message: result.message });
    }
  } catch (err) {
    console.error('Password change error:', err);
    showNotification('Error', 'An internal error occurred while changing password', 'error');
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

apiApp.post('/api/user/update-username', async (req, res) => {
  // Check if user is logged in
  if (!req.session.loggedIn || !req.session.user) {
    showNotification('Authentication Error', 'User not authenticated', 'error');
    return res.status(401).json({ success: false, message: 'User not authenticated' });
  }

  const { newUsername } = req.body;

  if (!newUsername || newUsername.trim() === '') {
    showNotification('Validation Error', 'Please provide a valid username', 'error');
    return res.status(400).json({ success: false, message: 'Please provide a valid username' });
  }

  try {
    const result = await updateUsername(newUsername.trim(), req.session.user.user_id);

    if (result.status === 'success') {
      // Update the session with new username
      req.session.user.username = newUsername.trim();
      showNotification('Username Updated', `Your username has been changed to '${newUsername.trim()}'`, 'success');
      return res.json({ success: true, message: result.message, newUsername: newUsername.trim() });
    } else {
      showNotification('Username Update Failed', result.message, 'error');
      return res.status(400).json({ success: false, message: result.message });
    }
  } catch (err) {
    console.error('Username update error:', err);
    showNotification('Error', 'An internal error occurred while updating username', 'error');
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Camera end-points

apiApp.post('/api/camera/add', async (req, res) => {
  const { name, client_id, rtspUrl } = req.body;
  if (!name || !client_id || !rtspUrl) {
    return res.status(400).json({ success: false, error: 'Provide all necessary information' });
  }

  try {
    const result = await addSource(rtspUrl, name, client_id);
    await initializeFeeds();

    if (result.success) {
      console.log(`✅ Successfully added new camera: ${name} (ID: ${result.source?.source_id})`);

      // Get client name for the response
      const { getAllClients } = require('./modules/clients.js');
      const clients = await getAllClients();
      const client = clients.find(c => c.client_id == client_id);

      // Include client_name in the response data
      const responseData = {
        ...result,
        source: {
          ...result.source,
          client_name: client?.client_name || 'Unknown Client'
        }
      };

      return res.json({ success: true, data: responseData });
    } else {
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (err) {
    console.error(`API Error adding camera "${name}":`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});


apiApp.get('/api/camera/get/names', async (req, res) => {
  const names = await getAllSources().then(sources =>
    sources.map(src => src.name)
  );
  return res.json({ success: true, data: names });
});

// Get all sources with full data (including source_id)
apiApp.get('/api/sources', async (req, res) => {
  try {
    const sources = await getAllSources();

    return res.json({ success: true, data: sources });
  } catch (err) {
    console.error('Error fetching sources:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


apiApp.delete('/api/camera/:name', async (req, res) => {
  const name = req.params.name;
  try {
    await removeCamera(name);
    return res.json({ success: true });
  } catch (err) {
    console.error(`API Error removing camera "${name}":`, err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});


apiApp.get('/api/get/logs', async (req, res) => {
  const appLogs = await getAllLogs();

  return res.json({ success: true, data: appLogs });
});


// Resource monitoring end-points

let lastCpuUsage = process.cpuUsage();
let lastTimestamp = Date.now();

async function getCPUUsage(){
  try {
    const now = Date.now();
    const currentCpuUsage = process.cpuUsage();
    const deltaUser = currentCpuUsage.user - lastCpuUsage.user;
    const deltaSystem = currentCpuUsage.system - lastCpuUsage.system;
    const deltaMicros = deltaUser + deltaSystem;
    const deltaMs = now - lastTimestamp;
    
    lastCpuUsage = currentCpuUsage;
    lastTimestamp = now;
    
    const nodeCpuPercent = (deltaMicros / 1000) / deltaMs * 100;
    const backendResources = await getBackendResourceUsage();
    const ffmpegCpuPercent = parseFloat(backendResources.cpu) || 0;
    const sysLoadData = await si.currentLoad();
    const systemLoadPercent = sysLoadData.currentLoad;
    const combined = nodeCpuPercent + ffmpegCpuPercent;
    const totalUsage = Math.min(Math.max(combined, 0), 100);
    const cpuData = await si.cpu();
    const cpuInfoStr = `${cpuData.manufacturer} ${cpuData.brand} (${cpuData.speed} GHz, ${cpuData.cores} cores)`;

    const query = 'INSERT INTO cpu_monitoring (cpu_info, cpu_usage) VALUES (?, ?)';
    const params = [cpuInfoStr, totalUsage.toFixed(2)];

    db.run(query, params);
  } catch (err) {
    console.error('Error getting CPU usage', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

apiApp.get('/api/resources/get/cpu', async (req, res) => {
  try {
    // 1. Compute Node process CPU% since last check
    const now = Date.now();
    const currentCpuUsage = process.cpuUsage(); // { user, system } in microseconds since start
    const deltaUser = currentCpuUsage.user - lastCpuUsage.user;
    const deltaSystem = currentCpuUsage.system - lastCpuUsage.system;
    const deltaMicros = deltaUser + deltaSystem; // microseconds CPU time used since lastTimestamp
    const deltaMs = now - lastTimestamp; // wall-clock ms since lastTimestamp

    // Update for next call
    lastCpuUsage = currentCpuUsage;
    lastTimestamp = now;

    // CPU% for Node process on one core: (CPU-time ms / wall ms) * 100
    const nodeCpuPercent = (deltaMicros / 1000) / deltaMs * 100;

    // 2. Get ffmpeg processes CPU% (each entry proc.cpu is % of one core)
    const backendResources = await getBackendResourceUsage();
    // backendResources.cpu is a string like "12.34", sum of proc.cpu % values

    const ffmpegCpuPercent = parseFloat(backendResources.cpu) || 0;

    // 3. Optionally get overall system load (percent of all cores)
    //    systeminformation.currentLoad().currentLoad gives avg % across all cores
    const sysLoadData = await si.currentLoad();
    const systemLoadPercent = sysLoadData.currentLoad; // e.g. 37.5

    // 4. Decide what “cpu_usage” to return. For example:
    //    a) Total of Node + ffmpeg, capped at 100:
    const combined = nodeCpuPercent + ffmpegCpuPercent;
    const totalUsage = Math.min(Math.max(combined, 0), 100);

    const cpuData = await si.cpu();
    const cpuInfoStr = `${cpuData.manufacturer} ${cpuData.brand} (${cpuData.speed} GHz, ${cpuData.cores} cores)`;

    const query = 'INSERT INTO cpu_monitoring (cpu_info, cpu_usage) VALUES (?, ?)';
    const params = [cpuInfoStr, totalUsage.toFixed(2)];

    db.run(query, params, function (err) {
      if (err) {
        console.error('Error updating cpu data:', err.message);
        return resolve({ status: 'failed', message: 'Error occured while fetching cpu data' });
      }

      // return resolve({ status: 'success', message: 'Successfully updated cpu data' });
      return res.json({
        success: true,
        cpuDetails: {
          cpu_info: cpuInfoStr,
          cpu_usage: totalUsage.toFixed(2)
        }
      });
    });
  } catch (err) {
    console.error('Error in /api/resources/get/cpu:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

apiApp.get('/api/resources/get/cpu/history', async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM (SELECT * FROM cpu_monitoring ORDER BY id DESC LIMIT 30) AS subquery_alias ORDER BY id ASC', (err, rows) => {
        if (err) {
          return reject({ message: 'Error fetching CPU history' });
        }
        resolve(rows);
      });
    });

    return res.json(rows);
  } catch (error) {
    throw error;
  }
});

apiApp.get('/api/resources/get/network/history', async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM (SELECT * FROM network_monitoring ORDER BY id DESC LIMIT 30) AS subquery_alias ORDER BY id ASC', (err, rows) => {
        if (err) {
          return reject({ message: 'Error fetching network history' });
        }
        resolve(rows);
      });
    });

    console.log(rows)

    return res.json(rows);
  } catch (error) {
    throw error;
  }
});

apiApp.get('/api/resources/get/gpu/history', async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all('SELECT * FROM (SELECT * FROM gpu_monitoring ORDER BY id DESC LIMIT 30) AS subquery_alias ORDER BY id ASC', (err, rows) => {
        if (err) {
          return reject({ message: 'Error fetching GPU history' });
        }
        resolve(rows);
      });
    });

    console.log(rows)

    return res.json(rows);
  } catch (error) {
    throw error;
  }
});

// Helper function to format network speeds
function formatNetworkSpeed(bytesPerSecond) {
  const bits = bytesPerSecond * 8;

  if (bits < 1024) {
    return `${bits.toFixed(1)} bps`;
  } else if (bits < 1024 * 1024) {
    return `${(bits / 1024).toFixed(1)} Kbps`;
  } else if (bits < 1024 * 1024 * 1024) {
    return `${(bits / (1024 * 1024)).toFixed(1)} Mbps`;
  } else {
    return `${(bits / (1024 * 1024 * 1024)).toFixed(1)} Gbps`;
  }
}

// Network usage tracking variables
let lastNetworkStats = null;
let lastNetworkTimestamp = Date.now();

apiApp.get('/api/resources/get/network', async (req, res) => {
  try {
    const now = Date.now();
    const networkStats = await si.networkStats();
    const currentStats = networkStats[0];

    let rxSpeed = 0;
    let txSpeed = 0;

    if (lastNetworkStats && lastNetworkTimestamp) {
      const deltaTime = (now - lastNetworkTimestamp) / 1000;
      const deltaRx = currentStats.rx_bytes - lastNetworkStats.rx_bytes;
      const deltaTx = currentStats.tx_bytes - lastNetworkStats.tx_bytes;

      rxSpeed = Math.max(0, deltaRx / deltaTime);
      txSpeed = Math.max(0, deltaTx / deltaTime);
    }

    lastNetworkStats = currentStats;
    lastNetworkTimestamp = now;

    const networkInterfaces = await si.networkInterfaces();
    const primaryInterface = networkInterfaces.find(iface => iface.default) || networkInterfaces[0];
    const rxSpeedMbps = (rxSpeed * 8) / (1024 * 1024);
    const txSpeedMbps = (txSpeed * 8) / (1024 * 1024);
    const totalSpeedMbps = rxSpeedMbps + txSpeedMbps;

    const interface_name = primaryInterface ? `${primaryInterface.iface} (${primaryInterface.type})` : 'Unknown';
    const rx_speed = rxSpeedMbps.toFixed(3);
    const tx_speed = txSpeedMbps.toFixed(3);
    const total_speed = totalSpeedMbps.toFixed(3);
    const rx_speed_formatted = formatNetworkSpeed(rxSpeed);
    const tx_speed_formatted = formatNetworkSpeed(txSpeed);
    const total_speed_formatted = formatNetworkSpeed(rxSpeed + txSpeed);
    const rx_bytes = currentStats.rx_bytes;
    const tx_bytes = currentStats.tx_bytes;
    const interface_speed = primaryInterface ? primaryInterface.speed || 'Unknown' : 'Unknown';

    const query = 'INSERT INTO network_monitoring (interface_name, rx_speed, tx_speed, total_speed, rx_speed_formatted, tx_speed_formatted, total_speed_formatted, rx_bytes, tx_bytes, interface_speed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const params = [interface_name, rx_speed, tx_speed, total_speed, rx_speed_formatted, tx_speed_formatted, total_speed_formatted, rx_bytes, tx_bytes, interface_speed];

    db.run(query, params, function (err) {
      if (err) {
        console.error('Error updating network data:', err.message);
        return resolve({ status: 'failed', message: 'Error occured while fetching network data' });
      }

      return res.json({
        success: true,
        networkDetails: {
          interface_name: interface_name,
          rx_speed: rx_speed,
          tx_speed: tx_speed,
          total_speed: total_speed,
          rx_speed_formatted: rx_speed_formatted,
          tx_speed_formatted: tx_speed_formatted,
          total_speed_formatted: total_speed_formatted,
          rx_bytes: rx_bytes,
          tx_bytes: tx_bytes,
          interface_speed: interface_speed
        }
      });
    });
  } catch (err) {
    console.error('Error in /api/resources/get/network:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to execute commands
function execCommand(command) {
  return new Promise((resolve, reject) => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const child = spawn(cmd, args, { windowsHide: true });

    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      // This will be called for errors like EPERM or ENOENT
      return reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        // Command failed
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

// GPU usage tracking
apiApp.get('/api/resources/get/gpu', async (req, res) => {
  try {
    // Get static GPU information
    const graphics = await si.graphics();

    let gpuData = [];

    // Try to get real GPU metrics using nvidia-smi
    let gpuUsed = 'N/A';
    let gpuTotal = 'N/A';
    let gpuLoad = 'N/A';
    let gpuTemp = 'N/A';

    try {
      const stdout = await execCommand(
        'nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits'
      );
      [gpuUsed, gpuTotal, gpuLoad, gpuTemp] = stdout
        .trim()
        .split(',')
        .map(value => value.trim());

    } catch (error) {
      console.error(`Error fetching GPU metrics: ${error.message}`);
      // Try alternative approach for AMD or Intel GPUs
      try {
        // For non-NVIDIA GPUs, we might use WMI or other methods
        // For now, we'll provide basic info without real-time metrics
      } catch (fallbackError) {
        console.warn('Could not get GPU metrics from any source');
      }
    }

    // Merge static GPU info with dynamic metrics
    if (graphics.controllers && graphics.controllers.length > 0) {
      for (let i = 0; i < graphics.controllers.length; i++) {
        const gpu = graphics.controllers[i];

        // Use real data if available, otherwise show N/A
        const utilization = gpuLoad !== 'N/A' ? parseFloat(gpuLoad) : 0;
        const memoryUsed = gpuUsed !== 'N/A' ? parseInt(gpuUsed) : 0;
        const memoryTotal = gpuTotal !== 'N/A' ? parseInt(gpuTotal) : (gpu.vram || 0);
        const temperature = gpuTemp !== 'N/A' ? parseFloat(gpuTemp) : 0;

        gpuData.push({
          name: gpu.model || `GPU ${i + 1}`,
          vendor: gpu.vendor || 'Unknown',
          utilization: utilization, // Percentage 0-100
          memoryUsed: memoryUsed, // MB
          memoryTotal: memoryTotal, // MB
          memoryPercent: memoryTotal > 0 ? ((memoryUsed / memoryTotal) * 100).toFixed(1) : '0',
          temperature: temperature, // Celsius
          driver: gpu.driverVersion || 'Unknown',
          vram: gpu.vram || memoryTotal,
          bus: gpu.bus || 'Unknown',
          hasRealData: gpuLoad !== 'N/A'
        });
      }
    } else {
      gpuData.push({
        name: 'No GPU detected',
        vendor: 'Unknown',
        utilization: 0,
        memoryUsed: 0,
        memoryTotal: 0,
        memoryPercent: '0',
        temperature: 0,
        driver: 'Unknown',
        vram: 0,
        bus: 'Unknown',
        hasRealData: false
      });
    }

    const query = 'INSERT INTO gpu_monitoring (gpuDetails) VALUES (?)';
    const params = [JSON.stringify(gpuData)];

    db.run(query, params, function (err) {
      if (err) {
        console.error('Error updating GPU data:', err.message);
        return resolve({ status: 'failed', message: 'Error occured while fetching GPU data' });
      }

      return res.json({
        success: true,
        gpuDetails: gpuData
      });
    });
  } catch (err) {
    console.error('Error in /api/resources/get/gpu:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      gpuDetails: [{
        name: 'Error fetching GPU data',
        vendor: 'Unknown', 
        utilization: 0,
        memoryUsed: 0,
        memoryTotal: 0,
        memoryPercent: '0',
        temperature: 0,
        driver: 'Unknown',
        vram: 0,
        bus: 'Unknown',
        hasRealData: false
      }]
    });
  }
});

// Debug GPU data endpoint to see available properties
apiApp.get('/api/resources/debug/gpu', async (req, res) => {
  try {
    const graphics = await si.graphics();

    // Try to get GPU load using different methods
    let gpuLoad = null;
    try {
      gpuLoad = await si.currentLoad();
    } catch (e) {
      console.log('currentLoad not available for GPU');
    }

    // Try graphics card specific data
    let graphicsData = null;
    try {
      graphicsData = await si.graphics();
    } catch (e) {
      console.log('graphics data error:', e);
    }

    console.log('Full GPU data structure:', JSON.stringify(graphics, null, 2));
    console.log('GPU Load data:', JSON.stringify(gpuLoad, null, 2));

    return res.json({
      success: true,
      rawData: graphics,
      loadData: gpuLoad,
      graphicsData: graphicsData
    });
  } catch (err) {
    console.error('Error in debug GPU endpoint:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// RESOURCE MONITORING
async function getBackendResourceUsage() {
  const processName = 'ffmpeg.exe';
  try {
    const processes = await si.processes();
    const target = processes.list.filter(
      proc => proc.name.toLowerCase() === processName.toLowerCase()
    );
    if (target.length === 0) {
      // no matching process
      return { cpu: '0.00', ram: '0.00' };
    }
    const totalCpu = target.reduce((sum, proc) => sum + proc.cpu, 0);
    const totalRamBytes = target.reduce((sum, proc) => sum + proc.memRss, 0);
    return {
      cpu: totalCpu.toFixed(2),
      ram: (totalRamBytes / 1024 / 1024).toFixed(2),
    };
  } catch (error) {
    console.error(`Error fetching process info: ${error.message}`);
    throw error;
  }
}



// APPLICATION PROCESSES

function startMediaServer() {
  return new Promise((resolve, reject) => {
    // Determine correct path based on packaging
    const mediaServerPath = electronApp.isPackaged
      ? path.join(process.resourcesPath, 'app', 'electron', 'mediamtx.exe')
      : path.join(__dirname, 'mediamtx.exe');

    if (!fs.existsSync(mediaServerPath)) {
      return reject(new Error(`mediamtx.exe not found at ${mediaServerPath}`));
    }

    console.log(`Attempting to start MediaMTX from: ${mediaServerPath}`);

    let resolvedOrRejected = false;
    // Spawn process with explicit working directory and pipes
    mediaServerProcess = spawn(mediaServerPath, [], {
      cwd: path.dirname(mediaServerPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    mediaServerProcess.stdout.on('data', chunk => {
      const text = chunk.toString();
      console.log(`[MediaMTX stdout]: ${text.trim()}`);
      if (!resolvedOrRejected) {
        resolvedOrRejected = true;
        resolve();
      }
    });

    mediaServerProcess.stderr.on('data', errChunk => {
      const msg = errChunk.toString().trim();
      console.error(`[MediaMTX stderr]: ${msg}`);
      if (!resolvedOrRejected) {
        resolvedOrRejected = true;
        mediaServerProcess.kill();
        reject(new Error(`MediaMTX stderr: ${msg}`));
      }
    });

    mediaServerProcess.on('error', err => {
      console.error('Failed to start MediaMTX process:', err);
      if (!resolvedOrRejected) {
        resolvedOrRejected = true;
        reject(err);
      }
    });

    mediaServerProcess.on('close', code => {
      console.log(`MediaMTX exited with code ${code}`);
      if (!resolvedOrRejected) {
        resolvedOrRejected = true;
        reject(new Error(`MediaMTX process exited prematurely with code ${code}.`));
      }
    });
  });
}


async function cleanup() {
  try {
    await Promise.all([
      new Promise((resolve, reject) => {
        db.run('DELETE FROM cpu_monitoring', function (err) {
          if (err) {
            return reject(new Error('Error deleting CPU history: ' + err.message));
          }
          console.log(`Deleted ${this.changes} rows from cpu_monitoring`);
          resolve();
        });
      }),
      new Promise((resolve, reject) => {
        db.run('DELETE FROM network_monitoring', function (err) {
          if (err) {
            return reject(new Error('Error deleting network history: ' + err.message));
          }
          console.log(`Deleted ${this.changes} rows from network_monitoring`);
          resolve();
        });
      }),
      new Promise((resolve, reject) => {
        db.run('DELETE FROM gpu_monitoring', function (err) {
          if (err) {
            return reject(new Error('Error deleting GPU history: ' + err.message));
          }
          console.log(`Deleted ${this.changes} rows from gpu_monitoring`);
          resolve();
        });
      })
    ]);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
}




function createWindow() {
  win = new BrowserWindow({
    width: 450,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // Disable web security for localhost cross-origin requests
      nodeIntegration: false,
      contextIsolation: true
    },
  });

  win.removeMenu();
  const startURL = `http://localhost:${API_PORT}`;
  win.loadURL(startURL);

  win.on('close', (e) => {
    e.preventDefault();

    try {
      cleanup();
    } catch (err) {
      console.error('Error in cleanup:', err);
    }

    win.destroy();
  });
}

async function initializeFeeds() {
  try {
    const sources = await getAllSources();

    await Promise.allSettled(
      sources.map(src => {
        if (!src.name || !src.rtsp_link) {
          return Promise.resolve({
            status: 'skipped',
            reason: 'Incomplete data',
          });
        }
        return addCamera(src.name, src.client_name, src.rtsp_link).then(
          r => ({ status: 'fulfilled', value: r, name: src.name }),
          e => ({ status: 'rejected', reason: e, name: src.name })
        );
      })
    );
  } catch (dbErr) {
    console.error('Error initializing cameras from DB:', dbErr.message);
  }
}

electronApp.whenReady().then(async () => {
  createWindow();

  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  
  try {
    console.log('Starting MediaMTX...')
    await startMediaServer();
  } catch (err) {
    dialog.showErrorBox(
      'MediaMTX Startup Error',
      `Failed to launch MediaMTX:\n${err.message}`
    );

    electronApp.quit();
    return;
  }

  try {
    const sources = await getAllSources();

    await Promise.allSettled(
      sources.map(src => {
        if (!src.name || !src.rtsp_link) {
          return Promise.resolve({
            status: 'skipped',
            reason: 'Incomplete data',
          });
        }
        return addCamera(src.name, src.client_name, src.rtsp_link).then(
          r => ({ status: 'fulfilled', value: r, name: src.name }),
          e => ({ status: 'rejected', reason: e, name: src.name })
        );
      })
    );
  } catch (dbErr) {
    console.error('Error initializing cameras from DB:', dbErr.message);
  }

  startRecordingMonitor();
}).catch(err => {
  dialog.showErrorBox(
    'App Initialization Error',
    `Unexpected error:\n${err.message}`
  );
  electronApp.quit();
});


electronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    electronApp.quit();
  }
});


electronApp.on('will-quit', () => {
  console.log('App shutting down, cleaning up resources...');

  // Stop MediaMTX process
  if (mediaServerProcess) {
    mediaServerProcess.kill();
    mediaServerProcess = null;
  }

  if (activeRecordings.size > 0) {
    for (const [streamPath, recording] of activeRecordings.entries()) {
      try {
        if (recording.timeoutId) {
          clearTimeout(recording.timeoutId);
        }

        recording.process.kill('SIGTERM');
      } catch (error) {
        try {
          recording.process.kill('SIGKILL');
        } catch (forceError) {
          console.error(`Error force killing recording for ${streamPath}:`, forceError);
        }
      }
    }

    activeRecordings.clear();
    recordingTimeouts.clear();
  }
});

// Add endpoint for client-side validation notifications
apiApp.post('/api/notification', (req, res) => {
  const { title, body, type } = req.body;
  showNotification(title, body, type);
  res.json({ success: true });
});

// Screenshot endpoint
apiApp.post('/api/screenshot', async (req, res) => {
  try {
    const { imageData, filename, source } = req.body;

    if (!imageData || !filename) {
      return res.status(400).json({ success: false, error: 'Image data and filename are required' });
    }

    // Ensure recordings directory exists
    const recordingsDir = path.join(__dirname, '..', 'recordings');
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
    const filePath = path.join(recordingsDir, filename);

    fs.writeFileSync(filePath, base64Data, 'base64');

    res.json({
      success: true,
      message: 'Screenshot saved successfully',
      filename: filename,
      path: filePath
    });

  } catch (error) {
    console.error('Error saving screenshot:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recorded files
apiApp.get('/api/recordings', (req, res) => {
  try {
    const recordingsDir = path.join(__dirname, '..', 'recordings');

    if (!fs.existsSync(recordingsDir)) {
      return res.json({ success: true, recordings: [] });
    }

    const files = fs.readdirSync(recordingsDir)
      .filter(file => file.endsWith('.mp4') || file.endsWith('.png'))
      .map(file => {
        const filePath = path.join(recordingsDir, file);
        const stats = fs.statSync(filePath);

        return {
          filename: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          type: file.endsWith('.mp4') ? 'video' : 'image',
          sizeFormatted: formatFileSize(stats.size)
        };
      })
      .sort((a, b) => b.created - a.created); // Sort by newest first

    res.json({
      success: true,
      recordings: files,
      count: files.length
    });

  } catch (error) {
    console.error('Error getting recordings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

apiApp.get('/api/clients', async (req, res) => {
  try {
    const clients = await getAllClients();
    return res.json({ success: true, data: clients });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

apiApp.post('/api/clients', async (req, res) => {
  try {
    const { client_name } = req.body;

    if (!client_name || client_name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Client name is required' });
    }

    const result = await addClient(client_name.trim());

    if (result.status === 'success') {
      return res.json({ success: true, message: result.message });
    } else {
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error adding client:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

apiApp.put('/api/clients/:id', async (req, res) => {
  try {
    const client_id = parseInt(req.params.id);
    const { client_name } = req.body;

    if (!client_name || client_name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Client name is required' });
    }

    if (isNaN(client_id)) {
      return res.status(400).json({ success: false, error: 'Invalid client ID' });
    }

    const result = await updateClient(client_id, client_name.trim());

    if (result.status === 'success') {
      return res.json({ success: true, message: result.message });
    } else {
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error updating client:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

apiApp.delete('/api/clients/:id', async (req, res) => {
  try {
    const client_id = parseInt(req.params.id);

    if (isNaN(client_id)) {
      return res.status(400).json({ success: false, error: 'Invalid client ID' });
    }

    const result = await deleteClient(client_id);

    if (result.status === 'success') {
      return res.json({ success: true, message: result.message });
    } else {
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error deleting client:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// User CRUD endpoints
apiApp.get('/api/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    const safeUsers = users.map(user => ({
      user_id: user.user_id,
      username: user.username,
      user_level: user.user_level
    }));
    return res.json({ success: true, data: safeUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

apiApp.post('/api/users', async (req, res) => {
  try {
    const { username, password, confirm_pass, user_level } = req.body;

    if (!username || username.trim() === '') {
      return res.status(400).json({ success: false, error: 'Username is required' });
    }

    if (!password || password.trim() === '') {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }

    const result = await addUser({
      username: username.trim(),
      password,
      confirm_pass,
      user_level
    });

    if (result.status === 'success') {
      return res.json({ success: true, message: result.message });
    } else {
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error adding user:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

apiApp.put('/api/users/:id', async (req, res) => {
  try {
    const user_id = parseInt(req.params.id);
    const { username, user_level } = req.body;

    if (!username || username.trim() === '') {
      return res.status(400).json({ success: false, error: 'Username is required' });
    }

    if (isNaN(user_id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const result = await updateUser(user_id, { username: username.trim(), user_level });

    if (result.status === 'success') {
      return res.json({ success: true, message: result.message });
    } else {
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

apiApp.delete('/api/users/:id', async (req, res) => {
  try {
    const user_id = parseInt(req.params.id);

    if (isNaN(user_id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const result = await deleteUser(user_id);

    if (result.status === 'success') {
      return res.json({ success: true, message: result.message });
    } else {
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Update source by ID
apiApp.put('/api/sources/:id', async (req, res) => {
  try {
    const source_id = parseInt(req.params.id);
    const { name, rtsp_link, client_id } = req.body;

    if (isNaN(source_id)) {
      return res.status(400).json({ success: false, error: 'Invalid source ID' });
    }

    if (!name || !rtsp_link || !client_id) {
      return res.status(400).json({ success: false, error: 'Name, RTSP link, and client ID are required' });
    }

    if (isNaN(parseInt(client_id))) {
      return res.status(400).json({ success: false, error: 'Invalid client ID' });
    }

    const { updateSource } = require('./modules/sources.js');

    const result = await updateSource(source_id, {
      name: name.trim(),
      rtsp_link: rtsp_link.trim(),
      client_id: parseInt(client_id)
    });

    if (result.status === 'success') {
      console.log(`Successfully updated source ${source_id}`);
      return res.json({ success: true, message: result.message });
    } else {
      console.error(`Failed to update source ${source_id}: ${result.message}`);
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('Error updating source:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

apiApp.delete('/api/sources/:id', async (req, res) => {
  try {
    console.log(`DELETE /api/sources/:id called with params:`, req.params);
    const source_id = parseInt(req.params.id);

    if (isNaN(source_id)) {
      console.error(`Invalid source ID provided: ${req.params.id}`);
      return res.status(400).json({ success: false, error: 'Invalid source ID' });
    }

    console.log(`API: Attempting to delete source with ID: ${source_id}`);

    const result = await deleteSource(source_id);
    console.log(result);

    if (result.status === 'success') {
      console.log(`API: Successfully deleted source ${source_id}: ${result.message}`);
      return res.json({ success: true, message: result.message });
    } else {
      console.error(`API: Failed to delete source ${source_id}: ${result.message}`);
      return res.status(400).json({ success: false, error: result.message });
    }
  } catch (error) {
    console.error('API Error deleting source:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});


const activeRecordings = new Map(); // Track active recording processes
const MAX_CONCURRENT_RECORDINGS = 5; // Limit concurrent recordings to prevent resource exhaustion
const RECORDING_TIMEOUT = 3600000; // 1 hour timeout for recordings (in milliseconds)
const recordingTimeouts = new Map(); // Track recording timeouts

apiApp.post('/api/recording/toggle', async (req, res) => {
  try {
    const { action, source, streamPath } = req.body;

    if (!action || !streamPath) {
      return res.status(400).json({
        success: false,
        error: 'Action and stream path are required'
      });
    }

    const currentDate = new Date().toLocaleDateString().replaceAll("/", "-");
    const clientName = streamPath.split('/')[0];
    const cameraName = streamPath.split('/')[1];

    // ensure recordings dir exists
    const recordingsDir = path.join(__dirname, '..', 'recordings', currentDate, clientName, cameraName);
    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    if (action === 'start') {
      // enforce max concurrency
      if (activeRecordings.size >= MAX_CONCURRENT_RECORDINGS) {
        return res.status(429).json({
          success: false,
          error: `Maximum concurrent recordings limit reached (${MAX_CONCURRENT_RECORDINGS}).`
        });
      }

      // avoid duplicates
      if (activeRecordings.has(streamPath)) {
        return res.status(400).json({
          success: false,
          error: 'Stream is already being recorded'
        });
      }

      // verify stream
      const available = await validateStreamAvailability(streamPath);
      if (!available) {
        return res.status(400).json({
          success: false,
          error: `HLS stream not available for ${streamPath}.`
        });
      }

      // build filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safeSource = (source || streamPath).replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `recording_${safeSource}_${timestamp}.mp4`;
      const filePath = path.join(recordingsDir, filename);

      // ffmpeg args: copy codecs into mp4
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-i', `http://localhost:8888/${streamPath}/index.m3u8`,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-fflags', '+genpts',
        '-movflags', '+faststart',
        '-f', 'mp4',
        '-y',
        filePath
      ];

      // spawn with stdin pipe so we can send “q”
      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
        cwd: __dirname + '/..',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: false
      });

      // set up auto‑stop timeout
      const timeoutId = setTimeout(() => {
        console.log(`📹 Timeout for ${streamPath}, sending quit…`);
        if (activeRecordings.has(streamPath)) {
          activeRecordings.get(streamPath).process.stdin.write('q\n');
        }
      }, RECORDING_TIMEOUT);

      // track it
      activeRecordings.set(streamPath, {
        process: ffmpegProcess,
        filename,
        filePath,
        startTime: Date.now(),
        source: source || streamPath,
        timeoutId
      });
      recordingTimeouts.set(streamPath, timeoutId);

      // cleanup helper
      function cleanup(sp) {
        if (activeRecordings.has(sp)) {
          clearTimeout(activeRecordings.get(sp).timeoutId);
          recordingTimeouts.delete(sp);
          activeRecordings.delete(sp);
        }
      }

      ffmpegProcess.on('error', err => {
        console.error(`📹 FFmpeg error for ${streamPath}:`, err);
        cleanup(streamPath);
      });

      ffmpegProcess.on('exit', (code, signal) => {
        console.log(`📹 FFmpeg exited for ${streamPath}, code=${code}, signal=${signal}`);
        cleanup(streamPath);
      });

      // filter stderr for real errors
      ffmpegProcess.stderr.on('data', chunk => {
        const out = chunk.toString();
        if (/error|failed/.test(out)) {
          console.error(`📹 FFmpeg stderr for ${streamPath}:`, out.trim());
        }
        if (/Connection refused|No route to host/.test(out)) {
          console.error(`📹 Stream unreachable for ${streamPath}, quitting…`);
          ffmpegProcess.stdin.write('q\n');
        }
      });


      console.log(`📹 Started recording ${streamPath} → ${filename}`);
      return res.json({
        success: true,
        message: 'Recording started successfully',
        filename,
        streamPath,
        activeRecordings: activeRecordings.size,
        maxRecordings: MAX_CONCURRENT_RECORDINGS
      });

    } else if (action === 'stop') {
      const rec = activeRecordings.get(streamPath);
      if (!rec) {
        return res.status(400).json({
          success: false,
          error: 'No active recording found for this stream'
        });
      }

      // clear the auto‑timeout
      clearTimeout(rec.timeoutId);

      // ask FFmpeg to quit cleanly
      console.log(`📹 Sending “q” to FFmpeg for ${streamPath}`);
      rec.process.stdin.write('q\n');

      // fallback kill if it hangs
      setTimeout(() => {
        if (activeRecordings.has(streamPath)) {
          console.log(`📹 FFmpeg hung for ${streamPath}, forcing kill.`);
          rec.process.kill('SIGKILL');
        }
      }, 5000);

      const duration = Math.round((Date.now() - rec.startTime) / 1000);
      return res.json({
        success: true,
        message: 'Recording stop initiated; waiting for FFmpeg to finalize.',
        filename: rec.filename,
        duration,
        streamPath,
        activeRecordings: activeRecordings.size - 1
      });

    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Use "start" or "stop".'
      });
    }

  } catch (err) {
    console.error('Error in /api/recording/toggle:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Recording management endpoints
apiApp.post('/api/recording/stop-all', async (req, res) => {
  try {
    if (activeRecordings.size === 0) {
      return res.json({ success: true, message: 'No active recordings to stop', stoppedCount: 0 });
    }

    const stoppedRecordings = [];
    const recordingEntries = Array.from(activeRecordings.entries());

    for (const [streamPath, recording] of recordingEntries) {
      try {
        // Clear timeout
        if (recording.timeoutId) {
          clearTimeout(recording.timeoutId);
          recordingTimeouts.delete(streamPath);
        }

        // Stop the process
        recording.process.kill('SIGTERM');

        // Calculate duration
        const duration = Math.round((Date.now() - recording.startTime) / 1000);

        stoppedRecordings.push({
          streamPath,
          filename: recording.filename,
          duration
        });

        console.log(`📹 Stopped recording for ${streamPath}: ${recording.filename} (${duration}s)`);
      } catch (error) {
        console.error(`📹 Error stopping recording for ${streamPath}:`, error);
      }
    }

    // Clear all recordings
    activeRecordings.clear();
    recordingTimeouts.clear();

    res.json({
      success: true,
      message: `Stopped ${stoppedRecordings.length} recording(s)`,
      stoppedRecordings: stoppedRecordings,
      stoppedCount: stoppedRecordings.length
    });

  } catch (error) {
    console.error('Error stopping all recordings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recording resource usage
apiApp.get('/api/recording/resource-usage', async (req, res) => {
  try {
    const usage = await getBackendResourceUsage();

    res.json({
      success: true,
      resourceUsage: {
        ffmpegCpu: usage.cpu,
        ffmpegRam: usage.ram,
        activeRecordings: activeRecordings.size,
        maxRecordings: MAX_CONCURRENT_RECORDINGS,
        availableSlots: MAX_CONCURRENT_RECORDINGS - activeRecordings.size,
        recordingTimeout: RECORDING_TIMEOUT / 1000 / 60, // in minutes
        processes: Array.from(activeRecordings.entries()).map(([streamPath, recording]) => ({
          streamPath,
          filename: recording.filename,
          duration: Math.round((Date.now() - recording.startTime) / 1000),
          pid: recording.process.pid
        }))
      }
    });
  } catch (error) {
    console.error('Error getting recording resource usage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check for recording system
apiApp.get('/api/recording/health', (req, res) => {
  try {
    const now = Date.now();
    const healthData = {
      status: 'healthy',
      activeRecordings: activeRecordings.size,
      maxRecordings: MAX_CONCURRENT_RECORDINGS,
      utilization: Math.round((activeRecordings.size / MAX_CONCURRENT_RECORDINGS) * 100),
      issues: []
    };

    // Check for long-running recordings (over 50% of timeout)
    const longRunningThreshold = RECORDING_TIMEOUT * 0.5;
    for (const [streamPath, recording] of activeRecordings.entries()) {
      const duration = now - recording.startTime;
      if (duration > longRunningThreshold) {
        healthData.issues.push({
          type: 'long_running',
          streamPath,
          duration: Math.round(duration / 1000),
          message: `Recording has been running for ${Math.round(duration / 1000 / 60)} minutes`
        });
      }
    }

    // Check system utilization
    if (activeRecordings.size >= MAX_CONCURRENT_RECORDINGS * 0.8) {
      healthData.status = 'warning';
      healthData.issues.push({
        type: 'high_utilization',
        message: `High recording utilization: ${activeRecordings.size}/${MAX_CONCURRENT_RECORDINGS}`
      });
    }

    if (activeRecordings.size >= MAX_CONCURRENT_RECORDINGS) {
      healthData.status = 'critical';
      healthData.issues.push({
        type: 'max_capacity',
        message: 'Maximum recording capacity reached'
      });
    }

    res.json({
      success: true,
      health: healthData
    });
  } catch (error) {
    console.error('Error getting recording health:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process monitoring and cleanup utilities
function startRecordingMonitor() {
  setInterval(() => {
    const now = Date.now();

    // Check for orphaned or problematic recordings
    for (const [streamPath, recording] of activeRecordings.entries()) {
      const duration = now - recording.startTime;

      // Check if process is still alive
      try {
        process.kill(recording.process.pid, 0); // Check if process exists without killing it
      } catch (error) {
        if (error.code === 'ESRCH') {
          // Process doesn't exist, clean it up
          console.log(`📹 Cleaning up orphaned recording process for ${streamPath}`);
          if (recording.timeoutId) {
            clearTimeout(recording.timeoutId);
            recordingTimeouts.delete(streamPath);
          }
          activeRecordings.delete(streamPath);
        }
      }

      // Log warning for long-running recordings
      if (duration > RECORDING_TIMEOUT * 0.8) {
        console.warn(`📹 Warning: Recording for ${streamPath} has been running for ${Math.round(duration / 1000 / 60)} minutes`);
      }
    }

    // Log resource usage if recordings are active
    if (activeRecordings.size > 0) {
      console.log(`📹 Recording monitor: ${activeRecordings.size}/${MAX_CONCURRENT_RECORDINGS} active recordings`);
    }
  }, 30000); // Check every 30 seconds
}

// Optimized stream validation with caching
const streamValidationCache = new Map();
const VALIDATION_CACHE_TTL = 30000; // 30 seconds

async function validateStreamAvailability(streamPath) {
  const cacheKey = streamPath;
  const cached = streamValidationCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < VALIDATION_CACHE_TTL) {
    return cached.isAvailable;
  }

  return new Promise(resolve => {
    const options = {
      hostname: 'localhost',
      port: 8888,
      path: `/${streamPath}/index.m3u8`,
      method: 'GET',
      timeout: 5000,
    };

    const req = http.request(options, res => {
      const isAvailable = res.statusCode >= 200 && res.statusCode < 400;
      // Cache result
      streamValidationCache.set(cacheKey, {
        isAvailable,
        timestamp: Date.now()
      });
      // We only needed headers—abort body download
      res.destroy();
      resolve(isAvailable);
    });

    req.on('error', () => {
      streamValidationCache.set(cacheKey, { isAvailable: false, timestamp: Date.now() });
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      streamValidationCache.set(cacheKey, { isAvailable: false, timestamp: Date.now() });
      resolve(false);
    });

    req.end();
  });
}

// Clean up validation cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of streamValidationCache.entries()) {
    if (now - value.timestamp > VALIDATION_CACHE_TTL * 2) {
      streamValidationCache.delete(key);
    }
  }
}, 60000); // Clean every minute