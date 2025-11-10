import React, { useState } from 'react';

export default function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('http://localhost:8000/api/user/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server returned ${res.status}`);
      }

      const data = await res.json();

      console.log(data);

      if (data.success) {
        onLoginSuccess();
      } else {
        throw new Error(data.message || 'Login failed');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="login-page" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <form
        id="login-form"
        onSubmit={handleSubmit}
        style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <h1 style={{ textAlign: 'center' }}>Verdin</h1>

        <input
          type="text"
          name="username"
          placeholder="Username…"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
        />

        <input
          type="password"
          name="password"
          placeholder="Password…"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {error && (
          <div style={{ color: 'red', fontSize: 14, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={loading}>
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
    </div>
  );
}
