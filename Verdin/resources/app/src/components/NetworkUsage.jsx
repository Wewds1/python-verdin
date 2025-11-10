import React, { useState, useEffect, useRef } from 'react';

export default function NetworkUsage() {
  const [networkSpeed, setNetworkSpeed] = useState(null);
  const [interfaceName, setInterfaceName] = useState(null);
  const [rxSpeed, setRxSpeed] = useState(null);
  const [txSpeed, setTxSpeed] = useState(null);
  const [rxSpeedFormatted, setRxSpeedFormatted] = useState(null);
  const [txSpeedFormatted, setTxSpeedFormatted] = useState(null);
  const [totalSpeedFormatted, setTotalSpeedFormatted] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Each entry: { time: Date, rx: number, tx: number, total: number }
  const [networkUsageData, setNetworkUsageData] = useState([]);
  const maxDataPoints = 30;
  const fetchIntervalMs = 5000;
  const threshold = 1; // highlight above 1 Mbps

  const networkCanvasRef = useRef(null);
  const tooltipRef = useRef(null);
  const visibilityRef = useRef(document.visibilityState);



  useEffect(() => {
    const fetchNetworkHistory = async () => {
      try {        
        const res = await fetch('http://localhost:8000/api/resources/get/network/history', {
          credentials: 'include'
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} – ${text}`);
        }        
        
        const data = await res.json();

        console.log(data)

        data.forEach(usage => {
          setNetworkSpeed(usage.total_speed);
          setInterfaceName(usage.interface_name);
          setRxSpeed(usage.rx_speed);
          setTxSpeed(usage.tx_speed);
          setRxSpeedFormatted(usage.rx_speed_formatted);
          setTxSpeedFormatted(usage.tx_speed_formatted);
          setTotalSpeedFormatted(usage.total_speed_formatted);
          setNetworkUsageData(prev => {
            const entry = { 
              time: new Date(usage.timestamp), 
              rx: parseFloat(usage.rx_speed) || 0,
              tx: parseFloat(usage.tx_speed) || 0,
              total: parseFloat(usage.total_speed) || 0
            };
            const next = [...prev, entry];
            return next.length > maxDataPoints
              ? next.slice(next.length - maxDataPoints)
              : next;
          });
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      }
    }

    fetchNetworkHistory();
  }, []);





  // --- Data fetching with abort + visibility pause ---
  useEffect(() => {
    let abortController = new AbortController();

    const fetchLoop = async () => {
      setLoading(true);
      setError(null);
      try {        
        const res = await fetch('http://localhost:8000/api/resources/get/network', {
          signal: abortController.signal,
          credentials: 'include'
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} – ${text}`);
        }        
        
        const data = await res.json();
        
        setNetworkSpeed(data.networkDetails.total_speed);
        setInterfaceName(data.networkDetails.interface_name);
        setRxSpeed(data.networkDetails.rx_speed);
        setTxSpeed(data.networkDetails.tx_speed);
        setRxSpeedFormatted(data.networkDetails.rx_speed_formatted);
        setTxSpeedFormatted(data.networkDetails.tx_speed_formatted);
        setTotalSpeedFormatted(data.networkDetails.total_speed_formatted);
        setNetworkUsageData(prev => {
          const entry = { 
            time: new Date(), 
            rx: parseFloat(data.networkDetails.rx_speed) || 0,
            tx: parseFloat(data.networkDetails.tx_speed) || 0,
            total: parseFloat(data.networkDetails.total_speed) || 0
          };
          const next = [...prev, entry];
          return next.length > maxDataPoints
            ? next.slice(next.length - maxDataPoints)
            : next;
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        setLoading(false);
        abortController = new AbortController();
        setTimeout(fetchLoop, fetchIntervalMs);
      }
    };

    fetchLoop();
    return () => {
      abortController.abort();
    };
  }, []);

  // --- Canvas drawing with ResizeObserver & hover ---
  useEffect(() => {
    const canvas = networkCanvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let resizeObserver;
    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      const margin = { top: 25, right: 10, bottom: 30, left: 50 };
      const gw = w - margin.left - margin.right;
      const gh = h - margin.top - margin.bottom;

      // background
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, w, h);      // Find max value for scaling
      const dataMax = networkUsageData.length > 0 ? 
        Math.max(...networkUsageData.map(d => Math.max(d.rx, d.tx, d.total))) : 0;
      
      // Set minimum scale based on data - if data is very small, use smaller scale
      let minScale;
      if (dataMax > 1) minScale = 5;       // If data > 1 Mbps, min scale 5 Mbps
      else if (dataMax > 0.1) minScale = 1; // If data > 0.1 Mbps, min scale 1 Mbps
      else minScale = 0.1;                   // If data very small, min scale 0.1 Mbps
      
      const maxVal = Math.max(minScale, dataMax * 1.2); // Add 20% padding
      const hlines = 10;      // horizontal grid
      ctx.beginPath();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.3;
      for (let i = 0; i <= hlines; i++) {
        const y = margin.top + (i * gh / hlines);
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + gw, y);
        const val = maxVal - (i * maxVal / hlines);
        ctx.fillStyle = '#aaa';
        ctx.font = '9px Arial';
        ctx.textAlign = 'right';
        // Format the label based on the value size
        let label;
        if (val >= 1) {
          label = val.toFixed(1);
        } else if (val >= 0.1) {
          label = val.toFixed(2);
        } else {
          label = val.toFixed(3);
        }
        ctx.fillText(label, margin.left - 5, y + 3);
      }
      ctx.stroke();
      ctx.closePath();

      // vertical slots
      ctx.beginPath();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.2;
      for (let i = 0; i < maxDataPoints; i++) {
        const x = margin.left + (i * gw / (maxDataPoints - 1));
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + gh);
      }
      ctx.stroke();
      ctx.closePath();

      // threshold line
      const ty = margin.top + gh - ((threshold / maxVal) * gh);
      ctx.strokeStyle = 'orange';
      ctx.lineWidth = 1;
      ctx.setLineDash([4,2]);
      ctx.beginPath();
      ctx.moveTo(margin.left, ty);
      ctx.lineTo(margin.left + gw, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      // plot lines + dots
      const n = networkUsageData.length;
      if (n) {
        // Draw RX (download) line
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00'; // Green for download
        ctx.lineWidth = 2;
        networkUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.rx);
          const y = margin.top + gh - ((v / maxVal) * gh);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw TX (upload) line
        ctx.beginPath();
        ctx.strokeStyle = '#ff4444'; // Red for upload
        ctx.lineWidth = 2;
        networkUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.tx);
          const y = margin.top + gh - ((v / maxVal) * gh);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Total line
        ctx.beginPath();
        ctx.strokeStyle = '#00adee'; // Blue for total
        ctx.lineWidth = 2;
        networkUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.total);
          const y = margin.top + gh - ((v / maxVal) * gh);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // dots for total line
        networkUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.total);
          const y = margin.top + gh - ((v / maxVal) * gh);

          ctx.beginPath();
          ctx.arc(x, y, 3, 0, 2*Math.PI);
          ctx.fillStyle = (v >= threshold ? 'orange' : '#00adee');
          ctx.fill();
          ctx.closePath();
        });
      }

      // X-axis labels every 5 slots
      ctx.fillStyle = '#ccc';
      ctx.font = '9px Arial';
      ctx.textAlign = 'center';
      for (let i = 0; i < maxDataPoints; i += 5) {
        const x = margin.left + (i * gw / (maxDataPoints - 1));
        const idx = i - (maxDataPoints - networkUsageData.length);
        if (idx >= 0 && idx < networkUsageData.length) {
          const t = networkUsageData[idx].time;
          ctx.fillText(t.toLocaleString(), x, margin.top + gh + 15);
        }
      }      // title and current stats on canvas
      ctx.fillStyle = '#fff';
      ctx.font = '11px Arial';
      ctx.textAlign = 'left';
      const latest = n ? networkUsageData[n-1] : null;
      ctx.fillText(interfaceName || 'Network Interface', margin.left, margin.top - 7);
      
      // Current usage on the right
      ctx.textAlign = 'right';
      const currentDownload = latest ? (rxSpeedFormatted || `${latest.rx.toFixed(1)} Mbps`) : '0 bps';
      const currentUpload = latest ? (txSpeedFormatted || `${latest.tx.toFixed(1)} Mbps`) : '0 bps';
      ctx.fillStyle = '#00ff00';
      ctx.fillText(`↓ ${currentDownload}`, margin.left + gw - 120, margin.top - 7);
      ctx.fillStyle = '#ff4444';
      ctx.fillText(`↑ ${currentUpload}`, margin.left + gw, margin.top - 7);
    };

    // initial draw + observe
    draw();
    resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);

    // hover handling
    const onMouseMove = e => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const margin = { top: 25, right: 10, bottom: 30, left: 50 };
      const gw = w - margin.left - margin.right;
      const gh = h - margin.top - margin.bottom;
      const n = networkUsageData.length;
      let found = null;      networkUsageData.forEach((pt, j) => {
        const slot = (maxDataPoints - n) + j;
        const x = margin.left + (slot * gw / (maxDataPoints - 1));
        const v = Math.max(0, pt.total);
        
        // Use the same maxVal calculation as in the drawing function
        const dataMax = networkUsageData.length > 0 ? 
          Math.max(...networkUsageData.map(d => Math.max(d.rx, d.tx, d.total))) : 0;
        
        let minScale;
        if (dataMax > 1) minScale = 5;       // If data > 1 Mbps, min scale 5 Mbps
        else if (dataMax > 0.1) minScale = 1; // If data > 0.1 Mbps, min scale 1 Mbps
        else minScale = 0.1;                   // If data very small, min scale 0.1 Mbps
        
        const maxVal = Math.max(minScale, dataMax * 1.2); // Add 20% padding
        
        const y = margin.top + gh - ((v/maxVal)*gh);
        if (Math.hypot(mx - x, my - y) < 6) {
          found = { x, y, ...pt };
        }
      });      if (found) {
        tooltip.style.display = 'block';
        // Position relative to the page, not just the canvas
        tooltip.style.left = `${rect.left + found.x + 10}px`;
        tooltip.style.top = `${rect.top + found.y + 10}px`;
        
        // Format the speeds for display
        const formatSpeed = (speedMbps) => {
          if (speedMbps >= 1) return `${speedMbps.toFixed(1)} Mbps`;
          if (speedMbps >= 0.001) return `${(speedMbps * 1000).toFixed(1)} Kbps`;
          return `${(speedMbps * 1000000).toFixed(0)} bps`;
        };
        
        tooltip.innerHTML = `
          <strong>Network Usage</strong><br/>
          Download: ${formatSpeed(found.rx)}<br/>
          Upload: ${formatSpeed(found.tx)}<br/>
          Total: ${formatSpeed(found.total)}<br/>
          ${found.time.toLocaleString()}
        `;
      } else {
        tooltip.style.display = 'none';
      }
    };    canvas.addEventListener('mousemove', onMouseMove);
    
    // Hide tooltip when mouse leaves canvas
    const onMouseLeave = () => {
      tooltip.style.display = 'none';
    };
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      resizeObserver?.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [networkUsageData, interfaceName]);

  return (
    <div id="network-usage" style={{ padding: 20, color: '#fff' }}>
      {error && <p style={{ color: 'salmon' }}>Error: {error}</p>}
      <div>
        <canvas
          ref={networkCanvasRef}
          style={{ width: '100%', height: 250, border: '1px solid #555', display: 'block' }}
        />        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            padding: '4px 8px',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            fontSize: 12,
            borderRadius: 4,
            display: 'none',
            zIndex: 1000
          }}
        />      </div>

      {(loading) ? <p style={{ fontSize: '0.8em', color: '#aaa' }}>Updating network data…</p> : <p style={{ fontSize: '0.8em', color: '#aaa' }}>Last updated: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>}
    </div>
  );
}
