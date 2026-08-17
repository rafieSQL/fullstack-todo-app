import LandingHero from './LandingHero.jsx'
import LandingFeatures from './LandingFeatures.jsx'
import LandingPricing from './LandingPricing.jsx'
import '../LandingPage.css'

export default function LandingPage({
  onOpenAuth = () => {},
  onEnterApp = () => {},
  session = null,
  displayName = ''
}) {
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
      <LandingHero
        session={session}
        onOpenAuth={onOpenAuth}
        onEnterApp={onEnterApp}
      />

      {/* 3. Bento Grid Showcase */}
      <LandingFeatures />

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
      <LandingPricing
        session={session}
        onOpenAuth={onOpenAuth}
        onEnterApp={onEnterApp}
      />

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
