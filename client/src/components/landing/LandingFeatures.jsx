export default function LandingFeatures() {
  return (
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
  )
}
