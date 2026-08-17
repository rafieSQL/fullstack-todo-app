export default function TaskMetrics({ metrics = { total: 0, pending: 0, completed: 0, highPriorityPending: 0 } }) {
  return (
    <section className="metrics-bar" aria-label="Task Summary Metrics">
      <div className="metric-card">
        <span className="metric-label">Total Tasks</span>
        <span className="metric-value">{metrics.total}</span>
      </div>
      <div className="metric-card">
        <span className="metric-label">Pending</span>
        <span className="metric-value">{metrics.pending}</span>
      </div>
      <div className="metric-card">
        <span className="metric-label">Completed</span>
        <span className="metric-value">{metrics.completed}</span>
      </div>
      <div className={`metric-card ${metrics.highPriorityPending > 0 ? 'highlight' : ''}`}>
        <span className="metric-label">High Priority</span>
        <span className="metric-value">{metrics.highPriorityPending}</span>
      </div>
    </section>
  )
}
