import TaskMetrics from './TaskMetrics.jsx'
import TaskInputBar from './TaskInputBar.jsx'
import TaskList from './TaskList.jsx'

const CATEGORY_ABBR = {
  General: 'GEN',
  Engineering: 'ENG',
  Design: 'DES',
  Personal: 'PERS'
}

export default function TaskRegistryView({
  metrics,
  taskInputRef,
  newTaskTitle,
  setNewTaskTitle,
  newCategory,
  setNewCategory,
  newPriority,
  setNewPriority,
  isSubmitting,
  handleAddTask,
  categories = ['General', 'Engineering', 'Design', 'Personal'],
  categoryCounts = {},
  categoryFilter = 'all',
  setCategoryFilter = () => {},
  activeTab = 'all',
  setActiveTab = () => {},
  searchInputRef,
  searchQuery = '',
  setSearchQuery = () => {},
  priorityFilter = 'all',
  setPriorityFilter = () => {},
  sortBy = 'custom',
  setSortBy = () => {},
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
  filteredTasks = [],
  handleClearCompleted = () => {}
}) {
  return (
    <div className="task-registry-view">
      {/* 1. Metrics Cards Bar */}
      <TaskMetrics metrics={metrics} />

      {/* 2. Task Input Bar */}
      <TaskInputBar
        taskInputRef={taskInputRef}
        newTaskTitle={newTaskTitle}
        setNewTaskTitle={setNewTaskTitle}
        newCategory={newCategory}
        setNewCategory={setNewCategory}
        newPriority={newPriority}
        setNewPriority={setNewPriority}
        isSubmitting={isSubmitting}
        handleAddTask={handleAddTask}
        categories={categories}
      />

      {/* 3. Consolidated Unified Toolbar: Workspaces, Status Tabs, Search, Priority, and Sort */}
      <section className="unified-toolbar" aria-label="Task Filters and Navigation">
        <div className="toolbar-top-row">
          {/* Workspaces Filter Chips */}
          <div className="workspace-tabs-group" role="tablist" aria-label="Filter by Workspace">
            <span className="cat-filter-label">Workspaces:</span>
            <button
              type="button"
              className={`cat-filter-chip ${categoryFilter === 'all' ? 'active' : ''}`}
              onClick={() => setCategoryFilter('all')}
            >
              ALL ({categoryCounts.all || 0})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`cat-filter-chip ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {CATEGORY_ABBR[cat]} ({categoryCounts[cat] || 0})
              </button>
            ))}
          </div>

          {/* Status Tabs */}
          <div className="tabs-group" role="tablist" aria-label="Filter by Status">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
              role="tab"
              aria-selected={activeTab === 'all'}
            >
              All <span className="tab-count">{metrics?.total || 0}</span>
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'active' ? 'active' : ''}`}
              onClick={() => setActiveTab('active')}
              role="tab"
              aria-selected={activeTab === 'active'}
            >
              Active <span className="tab-count">{metrics?.pending || 0}</span>
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'completed' ? 'active' : ''}`}
              onClick={() => setActiveTab('completed')}
              role="tab"
              aria-selected={activeTab === 'completed'}
            >
              Completed <span className="tab-count">{metrics?.completed || 0}</span>
            </button>
          </div>
        </div>

        <div className="toolbar-bottom-row">
          {/* Search bar */}
          <div className="search-input-wrapper">
            <input
              ref={searchInputRef}
              type="text"
              className="search-input"
              placeholder="Search tasks... (/)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              maxLength={100}
              aria-label="Search tasks"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
              >
                ✕
              </button>
            )}
          </div>

          {/* Priority Filter Chips */}
          <div className="priority-chips-group">
            <span className="sort-label">Priority:</span>
            {['all', 'high', 'medium', 'low'].map((p) => (
              <button
                key={p}
                type="button"
                className={`priority-chip ${priorityFilter === p ? 'active' : ''}`}
                onClick={() => setPriorityFilter(p)}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          {/* Sort Dropdown */}
          <div className="sort-group">
            <label htmlFor="sort-select" className="sort-label">Sort:</label>
            <select
              id="sort-select"
              className="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="custom">Custom Order (Drag & Drop)</option>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="priority">Priority (High to Low)</option>
              <option value="alphabetical">Title (A-Z)</option>
            </select>
          </div>
        </div>
      </section>

      {/* 4. Task List & Batch Operations */}
      <TaskList
        filteredTasks={filteredTasks}
        selectedTaskIds={selectedTaskIds}
        setSelectedTaskIds={setSelectedTaskIds}
        handleBatchStatus={handleBatchStatus}
        areAllFilteredSelected={areAllFilteredSelected}
        handleSelectAllFiltered={handleSelectAllFiltered}
        handleToggleSelect={handleToggleSelect}
        handleToggleTask={handleToggleTask}
        handleDeleteTask={handleDeleteTask}
        handleOpenFocusSession={handleOpenFocusSession}
        handleStartEdit={handleStartEdit}
        handleSaveEdit={handleSaveEdit}
        editingTaskId={editingTaskId}
        setEditingTaskId={setEditingTaskId}
        editingTitle={editingTitle}
        setEditingTitle={setEditingTitle}
        editInputRef={editInputRef}
        busyTaskIds={busyTaskIds}
        isDnDActive={isDnDActive}
        draggedTaskId={draggedTaskId}
        dragOverTaskId={dragOverTaskId}
        dropPosition={dropPosition}
        handleDragStart={handleDragStart}
        handleDragOver={handleDragOver}
        handleDragLeave={handleDragLeave}
        handleDrop={handleDrop}
        handleDragEnd={handleDragEnd}
        isLoading={isLoading}
        searchQuery={searchQuery}
        categoryFilter={categoryFilter}
        priorityFilter={priorityFilter}
        activeTab={activeTab}
        metrics={metrics}
        handleClearCompleted={handleClearCompleted}
      />
    </div>
  )
}
