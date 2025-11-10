import React, { useState, useEffect, useRef } from 'react';

export default function CpuUsage() {
  const [cpuUsage, setCpuUsage] = useState(null);
  const [cpuInfo, setCpuInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Each entry: { time: Date, value: number }
  const [cpuUsageData, setCpuUsageData] = useState([]);
  const maxDataPoints = 30;
  const fetchIntervalMs = 5000;
  const threshold = 75;   // highlight above this

  const cpuCanvasRef = useRef(null);
  const tooltipRef = useRef(null);
  const visibilityRef = useRef(document.visibilityState);

  // --- Data fetching with abort + visibility pause ---
  useEffect(() => {
    let abortController = new AbortController();

    const fetchLoop = async () => {
      setLoading(true);
      setError(null);
      try {        
        const res = await fetch('http://localhost:8000/api/resources/get/cpu', {
          signal: abortController.signal,
          credentials: 'include'
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} – ${text}`);
        }

        const data = await res.json();
        
        setCpuUsage(data.cpuDetails.cpu_usage);
        setCpuInfo(data.cpuDetails.cpu_info);

        setCpuUsageData(prev => {
          const entry = { time: new Date(), value: data.cpuDetails.cpu_usage };
          const next = [...prev, entry];
          return next.length > maxDataPoints
            ? next.slice(next.length - maxDataPoints)
            : next;
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
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
    const canvas = cpuCanvasRef.current;
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
      ctx.setLineDash([4,2]);
      ctx.beginPath();
      ctx.moveTo(margin.left, ty);
      ctx.lineTo(margin.left + gw, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      // plot line + dots
      const n = cpuUsageData.length;
      if (n) {
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, Math.min(100, cpuUsageData[j].value));
          const y = margin.top + gh - ((v / 100) * gh);

          // color segments above threshold
          if (j > 0) {
            const prevV = Math.max(0, Math.min(100, cpuUsageData[j-1].value));
            ctx.strokeStyle = (prevV >= threshold && v >= threshold) ? 'red' : '#00adee';
            ctx.lineWidth = 2;
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, y);
          } else {
            ctx.moveTo(x, y);
          }
        }
        ctx.closePath();

        // dots
        cpuUsageData.forEach((pt, j) => {
          const slot = (maxDataPoints - n) + j;
          const x = margin.left + (slot * gw / (maxDataPoints - 1));
          const v = Math.max(0, Math.min(100, pt.value));
          const y = margin.top + gh - ((v / 100) * gh);

          ctx.beginPath();
          ctx.arc(x, y, 3, 0, 2*Math.PI);
          ctx.fillStyle = (v >= threshold ? 'red' : '#00adee');
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
        const idx = i - (maxDataPoints - cpuUsageData.length);
        if (idx >= 0 && idx < cpuUsageData.length) {
          const t = cpuUsageData[idx].time;
          ctx.fillText(t.toLocaleTimeString(), x, margin.top + gh + 15);
        }
      }

      // title
      ctx.fillStyle = '#fff';
      ctx.font = '11px Arial';
      ctx.textAlign = 'left';
      const latest = n ? cpuUsageData[n-1].value : 'N/A';
      ctx.fillText(cpuInfo, margin.left, margin.top - 7);
      ctx.textAlign = 'right';
      ctx.fillText(`CPU Usage (${latest}%)`, margin.left + gw, margin.top - 7);
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
      const n = cpuUsageData.length;
      let found = null;

      cpuUsageData.forEach((pt, j) => {
        const slot = (maxDataPoints - n) + j;
        const x = margin.left + (slot * gw / (maxDataPoints - 1));
        const v = Math.max(0, Math.min(100, pt.value));
        const y = margin.top + gh - ((v/100)*gh);
        if (Math.hypot(mx - x, my - y) < 6) {
          found = { x, y, ...pt };
        }
      });      if (found) {
        tooltip.style.display = 'block';
        // Position relative to the page, not just the canvas
        tooltip.style.left = `${rect.left + found.x + 10}px`;
        tooltip.style.top = `${rect.top + found.y + 10}px`;
        tooltip.innerHTML = `
          <strong>${found.value}%</strong><br/>
          ${found.time.toLocaleTimeString()}
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
  }, [cpuUsageData]);

  return (
    <div id="cpu-usage" style={{ padding: 20, color: '#fff' }}>
      {error && <p style={{ color: 'salmon' }}>Error: {error}</p>}
      <div>
        <canvas
          ref={cpuCanvasRef}
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
        />
      </div>

      {loading && <p style={{ fontSize: '0.8em', color: '#aaa' }}>Updating data…</p>}
    </div>
  );
}
