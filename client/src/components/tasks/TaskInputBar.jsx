export default function TaskInputBar({
  taskInputRef,
  newTaskTitle,
  setNewTaskTitle,
  newCategory,
  setNewCategory,
  newPriority,
  setNewPriority,
  isSubmitting,
  handleAddTask,
  categories = ['General', 'Engineering', 'Design', 'Personal']
}) {
  return (
    <section className="task-form-card" aria-label="Add Task">
      <form onSubmit={handleAddTask}>
        <div className="input-row">
          <input
            ref={taskInputRef}
            type="text"
            className="task-input"
            placeholder="Add a new task... (press Enter to save)"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            maxLength={250}
            disabled={isSubmitting}
            autoFocus
            aria-label="New task title"
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={!newTaskTitle.trim() || isSubmitting}
          >
            {isSubmitting ? 'Adding...' : 'Add Task'}
          </button>
        </div>

        <div className="form-controls-row" style={{ marginTop: '12px' }}>
          <div className="form-selectors-left">
            {/* Category Selector */}
            <div className="selector-group">
              <span className="selector-label">Category:</span>
              <div className="selector-options" role="radiogroup" aria-label="Task Category">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`control-btn ${newCategory === cat ? 'active category-active' : ''}`}
                    onClick={() => setNewCategory(cat)}
                    role="radio"
                    aria-checked={newCategory === cat}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority Selector */}
            <div className="selector-group">
              <span className="selector-label">Priority:</span>
              <div className="selector-options" role="radiogroup" aria-label="Task Priority">
                {['low', 'medium', 'high'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`control-btn ${newPriority === p ? `active priority-${p}` : ''}`}
                    onClick={() => setNewPriority(p)}
                    role="radio"
                    aria-checked={newPriority === p}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <span className="input-hint">Enter ↵ to save</span>
        </div>
      </form>
    </section>
  )
}
