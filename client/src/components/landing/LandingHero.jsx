import { useState, useEffect } from 'react'

export default function LandingHero({
  session = null,
  onOpenAuth = () => {},
  onEnterApp = () => {}
}) {
  const [previewTimerSeconds, setPreviewTimerSeconds] = useState(1500)
  const [isPreviewRunning, setIsPreviewRunning] = useState(true)
  const [previewCompleted, setPreviewCompleted] = useState(false)

  // Interactive mini preview timer tick
  useEffect(() => {
    if (!isPreviewRunning) return
    const interval = setInterval(() => {
      setPreviewTimerSeconds((prev) => (prev > 0 ? prev - 1 : 1500))
    }, 1000)
    return () => clearInterval(interval)
  }, [isPreviewRunning])

  const formatPreviewTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return (
    <section className="landing-hero-section">
      <div className="landing-hero-glow" aria-hidden="true" />

      <div className="landing-hero-content">
        <div className="landing-pill-badge">
          <span className="badge-dot" />
          <span>⌘ Minimalist Voice-First Productivity Workspace</span>
        </div>

        <h1 className="landing-hero-headline">
          Struktur Harian Anda.<br />
          <span className="headline-highlight">Dirancang Tanpa Distraksi.</span>
        </h1>

        <p className="landing-hero-subtext">
          Eksekusi tugas berkecepatan tinggi, kontrol alur kerja via Voice Partner Whisper & Llama 3,
          serta timer fokus Zen Pomodoro terintegrasi dengan kalender timeboxing presisi.
        </p>

        <div className="landing-hero-cta-group">
          <button
            type="button"
            className="btn-hero-primary"
            onClick={session ? onEnterApp : onOpenAuth}
          >
            <span>Coba Gratis (14 Hari Pro+)</span>
            <span className="btn-arrow">→</span>
          </button>
          <button
            type="button"
            className="btn-hero-secondary"
            onClick={onEnterApp}
          >
            <span>Lihat Demo Interaktif</span>
          </button>
        </div>

        <div className="landing-reverse-trial-callout">
          <span className="callout-icon">✨</span>
          <span>Akses 14 hari Pro+ gratis saat pertama mendaftar tanpa kartu kredit.</span>
        </div>
      </div>

      {/* Hero Interactive UI Mockup */}
      <div className="landing-hero-mockup-wrapper">
        <div className="landing-browser-frame">
          <div className="browser-frame-header">
            <div className="browser-traffic-lights">
              <span className="traffic-dot red" />
              <span className="traffic-dot yellow" />
              <span className="traffic-dot green" />
            </div>
            <div className="browser-address-bar">
              <span>app.taskregistry.internal/#main</span>
            </div>
            <div className="browser-status-pill">
              <span className="live-dot" />
              <span>Voice Active</span>
            </div>
          </div>

          <div className="browser-mockup-body">
            <div className="mockup-sidebar">
              <div className="mockup-side-item active">
                <span>⚡ Registry</span>
              </div>
              <div className="mockup-side-item">
                <span>🗓️ Chronos</span>
              </div>
              <div className="mockup-side-item">
                <span>🎯 Focus</span>
              </div>
            </div>

            <div className="mockup-main">
              {/* Live Mockup Focus Stage */}
              <div className="mockup-focus-card">
                <div className="mockup-card-header">
                  <span className="mockup-tag">DEEP WORK SESSION</span>
                  <span className="mockup-prio-badge">HIGH PRIORITY</span>
                </div>
                <div className="mockup-timer-row">
                  <div
                    className="mockup-timer-digits"
                    onClick={() => setIsPreviewRunning(!isPreviewRunning)}
                    title="Klik untuk Pause/Resume"
                  >
                    {formatPreviewTime(previewTimerSeconds)}
                  </div>
                  <div className="mockup-timer-actions">
                    <button
                      type="button"
                      className="mockup-btn-toggle"
                      onClick={() => setIsPreviewRunning(!isPreviewRunning)}
                    >
                      {isPreviewRunning ? '⏸ Pause' : '▶ Start'}
                    </button>
                  </div>
                </div>
                <div className="mockup-task-target">
                  <button
                    type="button"
                    className={`mockup-check ${previewCompleted ? 'checked' : ''}`}
                    onClick={() => setPreviewCompleted(!previewCompleted)}
                  >
                    {previewCompleted ? '✓' : ''}
                  </button>
                  <span className={`mockup-task-name ${previewCompleted ? 'done' : ''}`}>
                    Audit Keamanan API & Optimasi DB Indexing
                  </span>
                </div>
              </div>

              {/* Live Mockup Voice Wave */}
              <div className="mockup-voice-capsule">
                <span className="voice-icon">🎙️</span>
                <span className="voice-text">"Partner, fokus ke task Audit Keamanan selama 25 menit"</span>
                <span className="voice-status">✓ Intent matched (98%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
