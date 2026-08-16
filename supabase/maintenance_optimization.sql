-- ============================================================================
-- Supabase Performance, Indexing & Storage Pruning Optimization
-- Execute in Supabase SQL Editor: https://supabase.com/dashboard/project/xfofsglaaldtyflaxciq/sql
-- ============================================================================

-- 1. High-Performance B-Tree Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user_order 
  ON public.tasks (user_id, "order" ASC);

CREATE INDEX IF NOT EXISTS idx_tasks_user_completed 
  ON public.tasks (user_id, completed);

CREATE INDEX IF NOT EXISTS idx_tasks_user_category 
  ON public.tasks (user_id, category);

CREATE INDEX IF NOT EXISTS idx_activity_user_created 
  ON public.activity_logs (user_id, created_at DESC);

-- 2. Auto-Prune Trigger Function to Cap Activity Logs at 30 Records Per User
CREATE OR REPLACE FUNCTION public.handle_prune_activity_logs()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete records older than the newest 30 for the current user
  DELETE FROM public.activity_logs
  WHERE id IN (
    SELECT id FROM public.activity_logs
    WHERE user_id = NEW.user_id
    ORDER BY created_at DESC
    OFFSET 30
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach Auto-Prune Trigger to activity_logs
DROP TRIGGER IF EXISTS trg_prune_activity_logs ON public.activity_logs;
CREATE TRIGGER trg_prune_activity_logs
  AFTER INSERT ON public.activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_prune_activity_logs();

-- 3. Initial Maintenance Cleanup (Prunes any existing records beyond 30 per user)
DELETE FROM public.activity_logs a
WHERE a.id NOT IN (
  SELECT id FROM public.activity_logs sub
  WHERE sub.user_id = a.user_id
  ORDER BY sub.created_at DESC
  LIMIT 30
);
