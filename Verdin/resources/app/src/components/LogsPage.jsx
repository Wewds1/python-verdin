import React, { useState, useEffect } from 'react';

export default function LogsPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/get/logs', {
          credentials: 'include'
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = await response.json();
        setData(json);
      } catch (error) {
        console.error(error);
      }
    };

    fetchData();
  }, []);

  // Safely log only if data is non-null
  console.log(data?.data);

  if (data === null) {
    return <div id="logs-container">Loading...</div>;
  }

  // If data.data is not an array, render a fallback
  if (!Array.isArray(data.data)) {
    return (
      <div id="logs-container">
        <p>Unexpected response format. “data.data” is not an array.</p>
      </div>
    );
  }

  return (
    <table id="logs-container">
        <thead>
        <tr>
          <th>Type</th>
          <th>Timestamp</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
      {data.data.length === 0 ? (
        <tr><td colSpan="3"></td>No logs to display.</tr>
      ) : (
        data.data.map((item) => (
          <tr key={item.log_id ?? Math.random()}>
            <td>
              {item.log_type}
            </td>
            <td>
              {item.log_timestamp}
            </td>
            <td>
              {item.description}
            </td>
          </tr>
        ))
      )}
      </tbody>
    </table>
  );
}
