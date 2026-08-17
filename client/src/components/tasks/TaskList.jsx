const CATEGORY_ABBR = {
  General: 'GEN',
  Engineering: 'ENG',
  Design: 'DES',
  Personal: 'PERS'
}

function formatTimeAgo(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export default function TaskList({
  filteredTasks = [],
  selectedTaskIds = [],
  setSelectedTaskIds = () => {},
  handleBatchStatus = () => {},
  areAllFilteredSelected = false,
  handleSelectAllFiltered = () => {},
  handleToggleSelect = () => {},
  handleToggleTask = () => {},
  handleDeleteTask = () => {},
  handleOpenFocusSession = () => {},
  handleStartEdit = () => {},
  handleSaveEdit = () => {},
  editingTaskId = null,
  setEditingTaskId = () => {},
  editingTitle = '',
  setEditingTitle = () => {},
  editInputRef = null,
  busyTaskIds = new Set(),
  isDnDActive = false,
  draggedTaskId = null,
  dragOverTaskId = null,
  dropPosition = null,
  handleDragStart = () => {},
  handleDragOver = () => {},
  handleDragLeave = () => {},
  handleDrop = () => {},
  handleDragEnd = () => {},
  isLoading = false,
  searchQuery = '',
  categoryFilter = 'all',
  priorityFilter = 'all',
  activeTab = 'all',
  metrics = { total: 0, completed: 0 },
  handleClearCompleted = () => {}
}) {
  return (
    <>
      {/* Multi-Selection Batch Action Bar */}
      {selectedTaskIds.length > 0 && (
        <section className="selection-action-bar" aria-label="Batch Actions">
          <span className="selection-count-text">
            {selectedTaskIds.length} item{selectedTaskIds.length === 1 ? '' : 's'} selected
          </span>
          <div className="selection-buttons">
            <button
              type="button"
              className="btn-batch primary"
              onClick={() => handleBatchStatus(true)}
            >
              Mark Complete
            </button>
            <button
              type="button"
              className="btn-batch"
              onClick={() => handleBatchStatus(false)}
            >
              Mark Active
            </button>
            <button
              type="button"
              className="btn-batch"
              onClick={() => setSelectedTaskIds([])}
            >
              Deselect All
            </button>
          </div>
        </section>
      )}

      {/* Task List */}
      <section className="task-list-container" aria-label="Task List">
        <div className="task-list-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              className="select-checkbox"
              checked={areAllFilteredSelected}
              onChange={handleSelectAllFiltered}
              aria-label="Select all displayed tasks"
              title="Select all"
            />
            <span>
              Items ({filteredTasks.length})
              {isDnDActive && (
                <span style={{ fontSize: '11px', fontWeight: 'normal', marginLeft: '6px', color: 'var(--text-subtle)' }}>
                  • Drag ⋮⋮ to reorder
                </span>
              )}
            </span>
          </div>
          <span>Tags, Priority & Actions</span>
        </div>

        {isLoading ? (
          <div className="loading-state">Loading tasks from registry...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">
              {searchQuery
                ? `No tasks matching "${searchQuery}"`
                : categoryFilter !== 'all'
                ? `No tasks in workspace "${categoryFilter}"`
                : priorityFilter !== 'all'
                ? `No ${priorityFilter} priority tasks found`
                : activeTab === 'completed'
                ? 'No completed tasks recorded'
                : activeTab === 'active'
                ? 'All pending tasks completed'
                : 'No tasks registered'}
            </span>
            <span className="empty-state-subtitle">
              {searchQuery || categoryFilter !== 'all' || priorityFilter !== 'all'
                ? 'Try adjusting your filters or search terms.'
                : 'Type a task in the field above and press Enter.'}
            </span>
          </div>
        ) : (
          <ul className="task-list">
            {filteredTasks.map((task) => {
              const isDragging = draggedTaskId === task.id
              const isDragOver = dragOverTaskId === task.id
              const isDragOverTop = isDragOver && dropPosition === 'top'
              const isDragOverBottom = isDragOver && dropPosition === 'bottom'

              const categoryClass = `cat-${(task.category || 'general').toLowerCase()}`
              const categoryAbbr = CATEGORY_ABBR[task.category] || CATEGORY_ABBR.General

              return (
                <li
                  key={task.id}
                  draggable={isDnDActive}
                  onDragStart={(e) => isDnDActive && handleDragStart(e, task)}
                  onDragOver={(e) => isDnDActive && handleDragOver(e, task)}
                  onDragLeave={isDnDActive ? handleDragLeave : undefined}
                  onDrop={(e) => isDnDActive && handleDrop(e, task)}
                  onDragEnd={isDnDActive ? handleDragEnd : undefined}
                  className={`task-item ${task.completed ? 'completed' : ''} ${
                    selectedTaskIds.includes(task.id) ? 'selected' : ''
                  } ${isDragging ? 'dragging' : ''} ${isDragOverTop ? 'drag-over-top' : ''} ${
                    isDragOverBottom ? 'drag-over-bottom' : ''
                  }`}
                >
                  <div className="task-item-left">
                    {isDnDActive && (
                      <span className="drag-handle" title="Drag to reorder" aria-hidden="true">
                        ⋮⋮
                      </span>
                    )}

                    <input
                      type="checkbox"
                      className="select-checkbox"
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={() => handleToggleSelect(task.id)}
                      aria-label={`Select task "${task.title}"`}
                    />

                    <button
                      type="button"
                      className={`custom-checkbox-btn ${task.completed ? 'checked' : ''}`}
                      onClick={() => handleToggleTask(task)}
                      disabled={busyTaskIds.has(task.id)}
                      role="checkbox"
                      aria-checked={task.completed}
                      aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
                    >
                      {task.completed && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>

                    <div className="task-content">
                      {editingTaskId === task.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          className="inline-edit-input"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          maxLength={250}
                          onBlur={() => handleSaveEdit(task)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(task)
                            if (e.key === 'Escape') setEditingTaskId(null)
                          }}
                          aria-label="Edit task title"
                        />
                      ) : (
                        <>
                          <span
                            className="task-title"
                            onDoubleClick={() => handleStartEdit(task)}
                            title="Double-click to edit title"
                          >
                            {task.title}
                          </span>
                          <button
                            type="button"
                            className="btn-edit-title"
                            onClick={() => handleStartEdit(task)}
                            aria-label={`Edit title for "${task.title}"`}
                            title="Edit title"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="task-item-right">
                    {/* Launch Focus Session on this Task Button */}
                    <button
                      type="button"
                      className="btn-edit-title"
                      onClick={() => handleOpenFocusSession(task)}
                      title={`Focus on "${task.title}"`}
                      aria-label={`Focus on "${task.title}"`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </button>

                    {/* Due Date Deadline Badge */}
                    {task.due_date && (
                      <span
                        className="task-deadline-badge"
                        title={`Deadline: ${new Date(task.due_date).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' })}`}
                      >
                        📅 {new Date(task.due_date).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' })}{' '}
                        {new Date(task.due_date).getHours() !== 23 || new Date(task.due_date).getMinutes() !== 59
                          ? new Date(task.due_date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </span>
                    )}

                    {/* Category Tag Badge */}
                    <span
                      className={`category-badge ${categoryClass}`}
                      title={`Workspace: ${task.category || 'General'}`}
                    >
                      {categoryAbbr}
                    </span>

                    {/* Priority Badge */}
                    <span className={`priority-badge priority-${task.priority}`}>
                      {task.priority}
                    </span>

                    <span className="task-timestamp" title={task.created_at ? new Date(task.created_at).toLocaleString() : ''}>
                      {formatTimeAgo(task.created_at || task.createdAt)}
                    </span>

                    <button
                      type="button"
                      className="btn-delete"
                      onClick={() => handleDeleteTask(task)}
                      aria-label={`Delete task "${task.title}"`}
                      title="Delete task"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Footer */}
        <footer className="task-list-footer">
          <span>
            {metrics.completed} of {metrics.total} task{metrics.total === 1 ? '' : 's'} completed
          </span>
          {metrics.completed > 0 && (
            <button
              type="button"
              className="btn-link"
              onClick={handleClearCompleted}
            >
              Clear completed ({metrics.completed})
            </button>
          )}
        </footer>
      </section>
    </>
  )
}
