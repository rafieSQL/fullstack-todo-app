import { useEffect } from 'react'

export default function Header({
  metrics,
  mainTab,
  setMainTab,
  session,
  displayName,
  handleSignOut,
  setIsDemoMode,
  handleOpenFocusSession,
  theme,
  toggleTheme,
  isActivityOpen,
  setIsActivityOpen,
  activities = [],
  loadTasks,
  isPartnerActive = false,
  isPartnerProcessing = false,
  onTogglePartner = () => {}
}) {
  // Keyboard Shortcut 'V' for Partner Voice Toggle (when not inside inputs)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT' ||
        e.target.isContentEditable
      ) {
        return
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        onTogglePartner()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onTogglePartner])

  return (
    <header className="app-header">
      <div className="header-title-group">
        <h1>Task Registry</h1>
        <div className="header-meta">
          <span>
            {metrics?.pending ?? 0} pending item{metrics?.pending === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Main Navigation Switcher (Tasks vs Chronos Calendar) */}
      <div className="header-nav-tabs" role="tablist" aria-label="Main Navigation">
        <button
          type="button"
          className={`btn-main-nav ${mainTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setMainTab('tasks')}
          title="Switch to Tasks Registry (T)"
          role="tab"
          aria-selected={mainTab === 'tasks'}
        >
          Tasks <kbd className="key-badge" style={{ fontSize: '9px', padding: '0 3px' }}>T</kbd>
        </button>
        <button
          type="button"
          className={`btn-main-nav ${mainTab === 'calendar' ? 'active' : ''}`}
          onClick={() => setMainTab('calendar')}
          title="Switch to Chronos Calendar (C)"
          role="tab"
          aria-selected={mainTab === 'calendar'}
        >
          Calendar <kbd className="key-badge" style={{ fontSize: '9px', padding: '0 3px' }}>C</kbd>
        </button>
      </div>

      <div className="header-actions">
        {/* Partner Voice Agent Toggle */}
        <button
          type="button"
          className={`btn-partner-voice ${isPartnerActive || isPartnerProcessing ? 'active' : ''}`}
          onClick={onTogglePartner}
          title="Toggle Partner Voice Note (V)"
          aria-pressed={isPartnerActive || isPartnerProcessing}
        >
          {isPartnerProcessing ? (
            <>
              <span className="voice-pulse-dot" />
              <span>⚡ Processing audio...</span>
            </>
          ) : isPartnerActive ? (
            <>
              <span className="voice-pulse-dot" />
              <span>🎙️ Recording voice...</span>
              <kbd className="key-badge" style={{ fontSize: '9px', padding: '0 3px' }}>V</kbd>
            </>
          ) : (
            <>
              <span>🎙️ Tell Partner</span>
              <kbd className="key-badge" style={{ fontSize: '9px', padding: '0 3px' }}>V</kbd>
            </>
          )}
        </button>

        {/* Account / Session Pill */}
        {session ? (
          <div
            className="user-session-group"
            title={`Signed in as ${displayName} (${session.user?.email || ''})`}
          >
            <span className="user-email-badge">@{displayName}</span>
            <button type="button" className="btn-signout" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        ) : (
          <div className="user-session-group">
            <span className="user-email-badge">Guest Operator</span>
            <button
              type="button"
              className="btn-signout"
              onClick={() => setIsDemoMode(false)}
            >
              Sign In
            </button>
          </div>
        )}

        {/* Zen Focus Session Trigger */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => handleOpenFocusSession()}
          title="Launch Zen Pomodoro Focus Session (F)"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          Focus <kbd className="key-badge" style={{ fontSize: '10px', padding: '0 3px' }}>F</kbd>
        </button>

        {/* Theme Switcher Button */}
        <button
          type="button"
          className="btn-theme-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          aria-label={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        >
          {theme === 'dark' ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* Activity Drawer Toggle */}
        <button
          type="button"
          className={`btn-secondary ${isActivityOpen ? 'active' : ''}`}
          onClick={() => setIsActivityOpen(!isActivityOpen)}
          title="Toggle system activity log"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          Activity {activities.length > 0 && `(${activities.length})`}
        </button>

        {/* Sync Tasks */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => loadTasks(true)}
          title="Refresh tasks from database"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
          Sync
        </button>
      </div>
    </header>
  )
}
