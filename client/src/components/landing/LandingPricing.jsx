import { useState } from 'react'

export default function LandingPricing({
  session = null,
  onOpenAuth = () => {},
  onEnterApp = () => {}
}) {
  const [billingCycle, setBillingCycle] = useState('annual') // 'monthly' | 'annual'

  return (
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
  )
}
