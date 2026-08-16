import './AmbientAura.css'

export default function AmbientAura({ isActive, isListening }) {
  if (!isActive) return null

  return (
    <div
      className={`ambient-aura-layer ${isListening ? 'listening' : ''}`}
      aria-hidden="true"
    >
      <div className="ambient-aura-glow" />
    </div>
  )
}
