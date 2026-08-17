import { useState, useEffect } from 'react'
import './LandingPage.css'

export default function LandingPage({
  onOpenAuth = () => {},
  onEnterApp = () => {},
  session = null,
  displayName = ''
}) {
  const [billingCycle, setBillingCycle] = useState('annual') // 'monthly' | 'annual'
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

  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="landing-page-root">
      {/* 1. Sticky Glass Navbar */}
      <nav className="landing-nav" aria-label="Main Navigation">
        <div className="landing-nav-container">
          <div className="landing-nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="landing-brand-icon">
              <span>⚡</span>
            </div>
            <span className="landing-brand-text">Task Registry & Focus</span>
          </div>

          <div className="landing-nav-links">
            <button type="button" className="nav-link-btn" onClick={() => scrollToSection('features')}>
              Features
            </button>
            <button type="button" className="nav-link-btn" onClick={() => scrollToSection('workflow')}>
              Workflow
            </button>
            <button type="button" className="nav-link-btn" onClick={() => scrollToSection('pricing')}>
              Pricing
            </button>
          </div>

          <div className="landing-nav-actions">
            {session ? (
              <button
                type="button"
                className="btn-landing-primary"
                onClick={onEnterApp}
              >
                <span>Buka Workspace ({displayName || 'User'})</span>
                <span className="btn-arrow">→</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-landing-ghost"
                  onClick={onOpenAuth}
                >
                  Masuk / Login
                </button>
                <button
                  type="button"
                  className="btn-landing-primary"
                  onClick={onEnterApp}
                >
                  <span>Buka Workspace</span>
                  <span className="btn-arrow">→</span>
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* 2. Hero Section */}
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
                <span>app.taskregistry.internal/workspace/deep-work</span>
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

      {/* 3. Bento Grid Showcase */}
      <section id="features" className="landing-bento-section">
        <div className="bento-header">
          <div className="landing-pill-badge">
            <span>Modular Craft Architecture</span>
          </div>
          <h2 className="bento-title">Tiga Pilar Produktivitas Tanpa Hambatan</h2>
          <p className="bento-subtitle">Dirancang untuk engineering, developer, dan kreator yang menuntut konsentrasi murni.</p>
        </div>

        <div className="bento-grid">
          {/* Bento Card 1: Voice Partner */}
          <div className="bento-card spotlight-card">
            <div className="bento-card-header">
              <div className="bento-icon-capsule">
                <span>🎙️</span>
              </div>
              <span className="bento-badge">GROQ WHISPER + LLAMA 3</span>
            </div>
            <h3 className="bento-card-title">Voice Command Natural Engine</h3>
            <p className="bento-card-desc">
              Katakan perintah dalam Bahasa Indonesia atau Inggris secara alami. Sistem secara otomatis memecah task,
              mengatur durasi timer fokus, dan menjadwalkan ke kalender.
            </p>
            <div className="bento-preview-pill">
              <span className="pill-code">"tugas ini selesai"</span>
              <span className="pill-arrow">→</span>
              <span className="pill-result">Sync Supabase ✓</span>
            </div>
          </div>

          {/* Bento Card 2: Zen Pomodoro */}
          <div className="bento-card spotlight-card">
            <div className="bento-card-header">
              <div className="bento-icon-capsule">
                <span>⏱️</span>
              </div>
              <span className="bento-badge">ZEN WORKSPACE</span>
            </div>
            <h3 className="bento-card-title">Deep Work Pomodoro Hub</h3>
            <p className="bento-card-desc">
              Masuk ke mode fokus fullscreen tanpa gangguan. Dilengkapi ambient binaural soundscapes,
              task targeting presisi, dan Picture-in-Picture mini player mengambang.
            </p>
            <div className="bento-preview-pill">
              <span className="pill-code">PiP Mini-Player</span>
              <span className="pill-arrow">•</span>
              <span className="pill-result">Ambient Soundscapes</span>
            </div>
          </div>

          {/* Bento Card 3: Chronos Timebox */}
          <div className="bento-card spotlight-card">
            <div className="bento-card-header">
              <div className="bento-icon-capsule">
                <span>🗓️</span>
              </div>
              <span className="bento-badge">CHRONOS TIMELINE</span>
            </div>
            <h3 className="bento-card-title">Timebox Day & Week Calendar</h3>
            <p className="bento-card-desc">
              Visualisasikan 24 jam timeline harian dan mingguan. Drag-and-drop task langsung dari backlog,
              dengan Velocity Auto-Morph Shield untuk mencegah tumpang tindih jadwal.
            </p>
            <div className="bento-preview-pill">
              <span className="pill-code">Drag & Drop</span>
              <span className="pill-arrow">•</span>
              <span className="pill-result">Collision Shield ON</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Workflow Section */}
      <section id="workflow" className="landing-workflow-section">
        <div className="workflow-container">
          <div className="landing-pill-badge">
            <span>Frictionless Flow</span>
          </div>
          <h2 className="workflow-title">Alur Kerja 3 Detik: Suara → Jadwal → Eksekusi</h2>

          <div className="workflow-steps-grid">
            <div className="workflow-step-card">
              <span className="step-number">01</span>
              <h4>Ucapkan Perintah Suara</h4>
              <p>Tekan tombol [V] dan katakan tugas Anda. AI mentranskripsi secara instan dengan akurasi tinggi.</p>
            </div>
            <div className="workflow-step-card">
              <span className="step-number">02</span>
              <h4>Auto-Timeboxing Kalender</h4>
              <p>Task otomatis ditempatkan pada slot waktu optimal tanpa perlu mengatur tanggal secara manual.</p>
            </div>
            <div className="workflow-step-card">
              <span className="step-number">03</span>
              <h4>Eksekusi di Zen Focus Hub</h4>
              <p>Mulai timer hitung mundur, dengarkan ambient sound, dan tandai task selesai via suara.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Interactive Pricing Matrix */}
      <section id="pricing" className="landing-pricing-section">
        <div className="pricing-header">
          <div className="landing-pill-badge">
            <span>Fair & Transparent Pricing</span>
          </div>
          <h2 className="pricing-title">Pilih Paket Sesuai Kebutuhan Produktivitas</h2>
          <p className="pricing-subtitle">
            Coba semua fitur Pro+ gratis 14 hari pertama. Tanpa komitmen, batalkan kapan saja.
          </p>

          {/* Billing Switcher Toggle */}
          <div className="billing-switch-container">
            <button
              type="button"
              className={`billing-toggle-btn ${billingCycle === 'monthly' ? 'active' : ''}`}
              onClick={() => setBillingCycle('monthly')}
            >
              Bulanan
            </button>
            <button
              type="button"
              className={`billing-toggle-btn ${billingCycle === 'annual' ? 'active' : ''}`}
              onClick={() => setBillingCycle('annual')}
            >
              <span>Tahunan</span>
              <span className="discount-badge">Hemat 25%</span>
            </button>
          </div>
        </div>

        {/* Pricing Cards Matrix */}
        <div className="pricing-cards-grid">
          {/* Card 1: Free */}
          <div className="pricing-card">
            <div className="pricing-card-top">
              <span className="plan-name">Free Starter</span>
              <p className="plan-desc">Untuk individu yang membutuhkan todo list esensial dan timer sederhana.</p>
              <div className="plan-price">
                <span className="currency">$</span>
                <span className="amount">0</span>
                <span className="period">/bulan</span>
              </div>
            </div>

            <button
              type="button"
              className="btn-plan-ghost"
              onClick={onEnterApp}
            >
              Mulai Gratis
            </button>

            <div className="plan-features-list">
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>Core Task Registry & Filtering</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>Standard Pomodoro Timer (25m)</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>1 Workspace Lokal</span>
              </div>
              <div className="plan-feature-item disabled">
                <span className="cross-icon">✕</span>
                <span>Voice Command Partner</span>
              </div>
              <div className="plan-feature-item disabled">
                <span className="cross-icon">✕</span>
                <span>Live Supabase Cloud Sync</span>
              </div>
            </div>
          </div>

          {/* Card 2: Pro (Highlighted with Visual Anchor) */}
          <div className="pricing-card pro-card popular-highlight">
            <div className="popular-ribbon">
              <span>★ Paling Populer</span>
            </div>

            <div className="pricing-card-top">
              <span className="plan-name">Pro Workspace</span>
              <p className="plan-desc">Solusi lengkap untuk profesional yang mengutamakan kecepatan suara dan deep work.</p>
              <div className="plan-price">
                <span className="currency">$</span>
                <span className="amount">{billingCycle === 'annual' ? '6' : '8'}</span>
                <span className="period">/bulan</span>
                {billingCycle === 'annual' && <span className="billed-note">(ditagih $72/tahun)</span>}
              </div>
            </div>

            <button
              type="button"
              className="btn-plan-primary"
              onClick={session ? onEnterApp : onOpenAuth}
            >
              <span>Mulai Uji Coba 14 Hari</span>
              <span className="btn-arrow">→</span>
            </button>

            <div className="plan-features-list">
              <div className="plan-feature-item highlight">
                <span className="check-icon emerald">✓</span>
                <strong>Unlimited Voice Partner (Whisper + Llama)</strong>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon emerald">✓</span>
                <span>Chronos 24-Hour Day & Week Calendar</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon emerald">✓</span>
                <span>Zen Ambient Soundscapes Library</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon emerald">✓</span>
                <span>Floating Picture-in-Picture Mini Player</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon emerald">✓</span>
                <span>Unlimited Workspaces & Cloud Sync</span>
              </div>
            </div>
          </div>

          {/* Card 3: Pro+ (Decoy Value Anchor) */}
          <div className="pricing-card pro-plus-card">
            <div className="pricing-card-top">
              <span className="plan-name">Pro+ Power User</span>
              <p className="plan-desc">Bagi power users yang memerlukan API prioritas, custom soundscapes, dan analitik.</p>
              <div className="plan-price">
                <span className="currency">$</span>
                <span className="amount">{billingCycle === 'annual' ? '9' : '12'}</span>
                <span className="period">/bulan</span>
                {billingCycle === 'annual' && <span className="billed-note">(ditagih $108/tahun)</span>}
              </div>
            </div>

            <button
              type="button"
              className="btn-plan-ghost"
              onClick={session ? onEnterApp : onOpenAuth}
            >
              Mulai Uji Coba Pro+
            </button>

            <div className="plan-features-list">
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>Semua Fitur Pro Workspace</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>Prioritas Cloud API & Bandwidth Khusus</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>Velocity Auto-Morph Collision Shield</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>Custom Binaural Soundscape Generator</span>
              </div>
              <div className="plan-feature-item">
                <span className="check-icon">✓</span>
                <span>Export & Calendar Webhook Integration</span>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Comparison Table */}
        <div className="pricing-comparison-table-wrapper">
          <h3 className="comparison-table-heading">Tabel Komparasi Fitur Lengkap</h3>
          <table className="comparison-table">
            <thead>
              <tr>
                <th className="feature-col">Fitur & Kapabilitas</th>
                <th>Free</th>
                <th className="highlight-th">Pro</th>
                <th>Pro+</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="feature-name">Core Task Management & Tags</td>
                <td>✓</td>
                <td className="highlight-td">✓</td>
                <td>✓</td>
              </tr>
              <tr>
                <td className="feature-name">Voice Partner (Speech-to-Intent)</td>
                <td>10x / hari</td>
                <td className="highlight-td"><strong>Unlimited</strong></td>
                <td><strong>Unlimited (Prioritas)</strong></td>
              </tr>
              <tr>
                <td className="feature-name">Chronos 24-Hour Timeboxing Grid</td>
                <td>Day View</td>
                <td className="highlight-td">Day, Week, Month</td>
                <td>Day, Week, Month + Auto-Morph</td>
              </tr>
              <tr>
                <td className="feature-name">Zen Pomodoro & Ambient Sounds</td>
                <td>Standard</td>
                <td className="highlight-td">Full Library</td>
                <td>Full Library + Binaural</td>
              </tr>
              <tr>
                <td className="feature-name">Floating PiP Mini Player</td>
                <td>✓</td>
                <td className="highlight-td">✓</td>
                <td>✓</td>
              </tr>
              <tr>
                <td className="feature-name">Multi-Device Cloud Sync via Supabase</td>
                <td>1 Perangkat</td>
                <td className="highlight-td">Unlimited</td>
                <td>Unlimited + Prioritas</td>
              </tr>
              <tr>
                <td className="feature-name">14-Day Reverse Trial Tanpa Kartu Kredit</td>
                <td>—</td>
                <td className="highlight-td">✓ Aktif</td>
                <td>✓ Aktif</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 6. Minimalist Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-container">
          <div className="footer-left">
            <div className="footer-brand">
              <span className="brand-dot" />
              <span>Task Registry & Focus</span>
            </div>
            <p className="footer-copyright">
              © {new Date().getFullYear()} Task Registry & Focus. Engineered for deep work & speed.
            </p>
          </div>

          <div className="footer-center">
            <div className="system-status-indicator">
              <span className="status-pulse-dot" />
              <span>All Systems Operational • Supabase Cloud Verified</span>
            </div>
          </div>

          <div className="footer-right">
            <button type="button" className="footer-link-btn" onClick={() => scrollToSection('features')}>
              Features
            </button>
            <button type="button" className="footer-link-btn" onClick={() => scrollToSection('pricing')}>
              Pricing
            </button>
            <button type="button" className="footer-link-btn" onClick={onEnterApp}>
              Launch App
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
