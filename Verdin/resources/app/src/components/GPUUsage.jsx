import React, { useState, useEffect, useRef } from 'react';

export default function GPUUsage() {
  const [gpuData, setGpuData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Each entry: { time: Date, utilization: number, memoryPercent: number, temperature: number }
  const [gpuUsageData, setGpuUsageData] = useState([]);
  const maxDataPoints = 30;
  const fetchIntervalMs = 5000;
  const threshold = 80; // highlight above 80% utilization

  const gpuCanvasRef = useRef(null);
  const tooltipRef = useRef(null);
  const visibilityRef = useRef(document.visibilityState);




  useEffect(() => {
    const fetchCpuHistory = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/resources/get/gpu/history', {
          credentials: 'include'
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} – ${text}`);
        }

        const data = await res.json();

        data.forEach(usage => {
          setGpuData(JSON.parse(usage.gpuDetails));

          const primaryGpu = JSON.parse(usage.gpuDetails)[0];

          setGpuUsageData(prev => {
            const entry = {
              time: new Date(usage.timestamp),
              utilization: primaryGpu.utilization || 0,
              memoryPercent: parseFloat(primaryGpu.memoryPercent) || 0,
              temperature: primaryGpu.temperature || 0
            };
            const updated = [...prev, entry];
            return updated.length > maxDataPoints ? updated.slice(-maxDataPoints) : updated;
          });
        })
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      }
    }

    fetchCpuHistory();
  }, []);




  // --- Data fetching with abort + visibility pause ---
  useEffect(() => {
    let abortController = new AbortController();

    const fetchLoop = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('http://localhost:8000/api/resources/get/gpu', {
          signal: abortController.signal,
          credentials: 'include'
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} – ${text}`);
        }

        const data = await res.json();

        if (data.success && data.gpuDetails && data.gpuDetails.length > 0) {
          setGpuData(data.gpuDetails);

          // Use the first GPU for chart data (most common case)
          const primaryGpu = data.gpuDetails[0];

          setGpuUsageData(prev => {
            const entry = {
              time: new Date(),
              utilization: primaryGpu.utilization || 0,
              memoryPercent: parseFloat(primaryGpu.memoryPercent) || 0,
              temperature: primaryGpu.temperature || 0
            };
            const updated = [...prev, entry];
            return updated.length > maxDataPoints ? updated.slice(-maxDataPoints) : updated;
          });
        }
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
    const canvas = gpuCanvasRef.current;
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
      ctx.fillRect(0, 0, w, h);

      // horizontal grid
      const maxVal = 100, hlines = 10;
      ctx.beginPath();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.3;
      for (let i = 0; i <= hlines; i++) {
        const y = margin.top + (i * gh / hlines);
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + gw, y);
        const val = Math.round(maxVal - (i * maxVal / hlines));
        ctx.fillStyle = '#aaa';
        ctx.font = '9px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(val, margin.left - 5, y + 3);
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
      ctx.strokeStyle = 'red';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.beginPath();
      ctx.moveTo(margin.left, ty);
      ctx.lineTo(margin.left + gw, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      // plot lines + dots
      const n = gpuUsageData.length;
      if (n) {
        // Draw Utilization line
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00'; // Green for utilization
        ctx.lineWidth = 2;
        gpuUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.utilization);
          const y = margin.top + gh - ((v / maxVal) * gh);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Draw Memory usage line
        ctx.beginPath();
        ctx.strokeStyle = '#ff4444'; // Red for memory
        ctx.lineWidth = 2;
        gpuUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.memoryPercent);
          const y = margin.top + gh - ((v / maxVal) * gh);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // dots for utilization line
        ctx.fillStyle = '#00ff00';
        gpuUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.utilization);
          const y = margin.top + gh - ((v / maxVal) * gh);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, 2 * Math.PI);
          ctx.fill();
        });

        // dots for memory line
        ctx.fillStyle = '#ff4444';
        gpuUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, pt.memoryPercent);
          const y = margin.top + gh - ((v / maxVal) * gh);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, 2 * Math.PI);
          ctx.fill();
        });
      }      // title and current stats on canvas
      ctx.fillStyle = '#fff';
      ctx.font = '11px Arial';
      ctx.textAlign = 'left';
      const latest = n ? gpuUsageData[n - 1] : null;
      const primaryGpu = gpuData[0];
      ctx.fillText(primaryGpu?.name || 'GPU', margin.left, margin.top - 7);

      // Current usage on the right
      ctx.textAlign = 'right';
      if (latest && primaryGpu) {
        ctx.fillStyle = '#00ff00';
        ctx.fillText(`${latest.utilization.toFixed(1)}%`, margin.left + gw - 100, margin.top - 7);
        ctx.fillStyle = '#ff4444';
        ctx.fillText(`${latest.memoryPercent.toFixed(1)}% RAM`, margin.left + gw, margin.top - 7);
      } else {
        ctx.fillStyle = '#aaa';
        ctx.fillText('No GPU Data', margin.left + gw, margin.top - 7);
      }
    };

    // hover
    const onMouseMove = (e) => {
      if (!gpuUsageData.length) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const margin = { top: 25, right: 10, bottom: 30, left: 50 };
      const gw = rect.width - margin.left - margin.right;

      if (mouseX < margin.left || mouseX > margin.left + gw) {
        tooltip.style.display = 'none';
        return;
      }

      const relativeX = mouseX - margin.left;
      const dataIndex = Math.round((relativeX / gw) * (maxDataPoints - 1));
      const actualIndex = dataIndex - (maxDataPoints - gpuUsageData.length);

      if (actualIndex >= 0 && actualIndex < gpuUsageData.length) {
        const item = gpuUsageData[actualIndex];
        const gpu = gpuData[0]; // Primary GPU

        let content = `GPU: ${gpu?.name || 'Unknown'}\n`;
        content += `Utilization: ${item.utilization.toFixed(1)}%\n`;
        content += `Memory: ${item.memoryPercent.toFixed(1)}%\n`;
        if (item.temperature > 0) {
          content += `Temperature: ${item.temperature}°C\n`;
        }
        if (gpu?.memoryUsed && gpu?.memoryTotal) {
          content += `VRAM: ${gpu.memoryUsed}MB / ${gpu.memoryTotal}MB`;
        }

        tooltip.textContent = content;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.pageX + 10) + 'px';
        tooltip.style.top = (e.pageY - 10) + 'px';
      } else {
        tooltip.style.display = 'none';
      }
    };

    const onMouseLeave = () => {
      tooltip.style.display = 'none';
    };

    // ResizeObserver
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => draw());
      resizeObserver.observe(canvas);
    }
    draw();

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      resizeObserver?.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [gpuUsageData, gpuData]);

  return (
    <div id="gpu-usage" style={{ padding: 20, color: '#fff' }}>
      {error && <p style={{ color: 'salmon' }}>Error: {error}</p>}
      <div>
        <canvas
          ref={gpuCanvasRef}
          style={{ width: '100%', height: 250, border: '1px solid #555', display: 'block' }}
        />
        <div
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
            zIndex: 1000,
            whiteSpace: 'pre-line'
          }}
        />      </div>

      {(loading) ? <p style={{ fontSize: '0.8em', color: '#aaa' }}>Updating GPU data…</p> : <p style={{ fontSize: '0.8em', color: '#aaa' }}>Last updated: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>}
    </div>
  );
}
