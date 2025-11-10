import React, { useEffect, useRef } from 'react';
import CpuUsage from './CpuUsage';
import NetworkUsage from './NetworkUsage';
import GPUUsage from './GPUUsage';

export default function ResourceMonitoringPage({ isVisible = true }) {
  const wasVisible = useRef(isVisible);

  useEffect(() => {
    // When becoming visible again, trigger any necessary updates
    if (isVisible && !wasVisible.current) {
      console.log('📊 ResourceMonitoring became visible - updating charts');
      // The individual components will handle their own updates
    }
    
    wasVisible.current = isVisible;
  }, [isVisible]);

  return (
    <div style={{ opacity: isVisible ? 1 : 0, transition: 'opacity 0.3s ease' }}>
      <CpuUsage />
      <NetworkUsage />
      <GPUUsage />
    </div>
  );
}
