import { useState } from 'react'
import { supabase, isSupabaseConfigured } from '../supabaseClient.js'

export default function Auth({ onDemoAccess }) {
  const [authMode, setAuthMode] = useState('sign_in') // 'sign_in' | 'sign_up' | 'magic_link'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const handleAuth = async (e) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!email.trim()) {
      setErrorMessage('Please provide a valid email address.')
      return
    }

    if (authMode !== 'magic_link' && (!password || password.length < 6)) {
      setErrorMessage('Password must be at least 6 characters long.')
      return
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
          email: email.trim(),
          password
        })
        if (error) throw error
      } else if (authMode === 'sign_up') {
        const { error, data } = await supabase.auth.signUp({
          email: email.trim(),
          password
        })
        if (error) throw error
        if (data?.user && !data?.session) {
          setSuccessMessage('Registration successful! Please check your email to confirm your account.')
        }
      } else if (authMode === 'magic_link') {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim()
        })
        if (error) throw error
        setSuccessMessage('Magic login link sent to your email. Click the link to authenticate.')
      }
    } catch (err) {
      console.error('Authentication error:', err)
      setErrorMessage(err.message || 'Authentication failed. Please verify your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
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
        <form onSubmit={handleAuth} className="auth-form">
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
              required
              autoFocus
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
