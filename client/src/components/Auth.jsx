import { useState } from 'react'
import { supabase, isSupabaseConfigured } from '../supabaseClient.js'
import { sanitizeEmail, sanitizeUsername } from '../utils/sanitize.js'

export default function Auth({ onDemoAccess, onClose }) {
  const [authMode, setAuthMode] = useState('sign_in') // 'sign_in' | 'sign_up' | 'magic_link'
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const handleAuth = async (e) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    const cleanedEmail = sanitizeEmail(email)

    if (!cleanedEmail || !cleanedEmail.includes('@') || !cleanedEmail.includes('.')) {
      setErrorMessage('Please provide a valid email address.')
      return
    }

    if (authMode === 'sign_up') {
      const cleanedUsername = sanitizeUsername(username)
      if (!cleanedUsername || cleanedUsername.length < 2) {
        setErrorMessage('Username must contain at least 2 characters.')
        return
      }
      if (cleanedUsername.length > 50) {
        setErrorMessage('Username cannot exceed 50 characters.')
        return
      }
    }

    if (authMode !== 'magic_link') {
      if (!password || password.length < 6) {
        setErrorMessage('Password must contain at least 6 characters.')
        return
      }
      if (password.length > 72) {
        setErrorMessage('Password cannot exceed 72 characters.')
        return
      }
    }

    if (!isSupabaseConfigured) {
      setErrorMessage(
        'Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env, or continue in Demo Mode below.'
      )
      return
    }

    setLoading(true)

    try {
      if (authMode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanedEmail,
          password
        })
        if (error) {
          // Unified non-leaking error message to prevent user enumeration
          throw new Error('Invalid email or password credentials.')
        }
      } else if (authMode === 'sign_up') {
        const cleanedUsername = sanitizeUsername(username)
        const { error, data } = await supabase.auth.signUp({
          email: cleanedEmail,
          password,
          options: {
            data: {
              username: cleanedUsername
            }
          }
        })
        if (error) {
          throw new Error(error.message || 'Unable to complete registration. Please verify details.')
        }
        if (data?.user && !data?.session) {
          setSuccessMessage('Verification link sent. Check your inbox to confirm your account.')
        }
      } else if (authMode === 'magic_link') {
        const { error } = await supabase.auth.signInWithOtp({
          email: cleanedEmail
        })
        if (error) {
          throw new Error('Unable to send magic link. Please check your email address.')
        }
        setSuccessMessage('Magic login link dispatched. Check your email to access the system.')
      }
    } catch (err) {
      console.error('Authentication attempt failed:', err)
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ position: 'relative' }}>
        {onClose && (
          <button
            type="button"
            className="auth-modal-close-btn"
            onClick={onClose}
            aria-label="Tutup Auth Modal"
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'transparent',
              border: 'none',
              color: '#a1a1aa',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px'
            }}
          >
            ✕
          </button>
        )}
        <header className="auth-header">
          <div className="auth-badge">SYSTEM ACCESS</div>
          <h2>Task Registry</h2>
          <p className="auth-subtitle">
            {authMode === 'sign_in'
              ? 'Authenticate to access your workspace backlog'
              : authMode === 'sign_up'
              ? 'Create a new operator account'
              : 'Receive a passwordless sign-in link via email'}
          </p>
        </header>

        {/* Configuration Notice if not set */}
        {!isSupabaseConfigured && (
          <div className="auth-setup-notice" role="alert">
            <span className="notice-title">Supabase Pending Configuration</span>
            <p>
              Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to{' '}
              <code>client/.env</code> to enable live PostgreSQL & Auth.
            </p>
          </div>
        )}

        {/* Messages */}
        {errorMessage && (
          <div className="auth-alert error" role="alert">
            {errorMessage}
          </div>
        )}
        {successMessage && (
          <div className="auth-alert success" role="status">
            {successMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleAuth} className="auth-form" noValidate>
          {authMode === 'sign_up' && (
            <div className="auth-field">
              <label htmlFor="auth-username" className="auth-label">
                Username
              </label>
              <input
                id="auth-username"
                type="text"
                className="auth-input"
                placeholder="e.g. Hormozi"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={50}
                required
                autoFocus
              />
            </div>
          )}

          <div className="auth-field">
            <label htmlFor="auth-email" className="auth-label">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              className="auth-input"
              placeholder="operator@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={100}
              required
              autoFocus={authMode !== 'sign_up'}
            />
          </div>

          {authMode !== 'magic_link' && (
            <div className="auth-field">
              <label htmlFor="auth-password" className="auth-label">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                className="auth-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={72}
                required
              />
            </div>
          )}

          <button type="submit" className="btn-auth-primary" disabled={loading}>
            {loading
              ? 'Authenticating...'
              : authMode === 'sign_in'
              ? 'Sign In with Password'
              : authMode === 'sign_up'
              ? 'Create Account'
              : 'Send Magic Link'}
          </button>
        </form>

        {/* Auth Mode Switcher */}
        <div className="auth-modes-row">
          <button
            type="button"
            className={`auth-mode-link ${authMode === 'sign_in' ? 'active' : ''}`}
            onClick={() => {
              setAuthMode('sign_in')
              setErrorMessage(null)
              setSuccessMessage(null)
            }}
          >
            Password Sign In
          </button>
          <span className="auth-dot">•</span>
          <button
            type="button"
            className={`auth-mode-link ${authMode === 'sign_up' ? 'active' : ''}`}
            onClick={() => {
              setAuthMode('sign_up')
              setErrorMessage(null)
              setSuccessMessage(null)
            }}
          >
            Sign Up
          </button>
          <span className="auth-dot">•</span>
          <button
            type="button"
            className={`auth-mode-link ${authMode === 'magic_link' ? 'active' : ''}`}
            onClick={() => {
              setAuthMode('magic_link')
              setErrorMessage(null)
              setSuccessMessage(null)
            }}
          >
            Magic Link
          </button>
        </div>

        {/* Demo Mode Button */}
        <div className="auth-footer-demo">
          <button type="button" className="btn-demo-access" onClick={onDemoAccess}>
            Continue as Guest / Demo Mode →
          </button>
        </div>
      </div>
    </div>
  )
}
