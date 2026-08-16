-- ============================================================================
-- Supabase PostgreSQL Security Hardening Script
-- Execute in Supabase SQL Editor: https://supabase.com/dashboard/project/xfofsglaaldtyflaxciq/sql
-- ============================================================================

-- 1. Ensure Extension for UUID Generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create / Recreate Tables with Strict Check Constraints
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  category TEXT NOT NULL DEFAULT 'General',
  completed BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Apply Strict Input Constraints on Columns
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS chk_tasks_title_length;
ALTER TABLE public.tasks ADD CONSTRAINT chk_tasks_title_length
  CHECK (length(trim(title)) > 0 AND length(title) <= 250);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS chk_tasks_priority;
ALTER TABLE public.tasks ADD CONSTRAINT chk_tasks_priority
  CHECK (priority IN ('low', 'medium', 'high'));

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS chk_tasks_category;
ALTER TABLE public.tasks ADD CONSTRAINT chk_tasks_category
  CHECK (category IN ('General', 'Engineering', 'Design', 'Personal'));

ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS chk_activity_message_length;
ALTER TABLE public.activity_logs ADD CONSTRAINT chk_activity_message_length
  CHECK (length(trim(message)) > 0 AND length(message) <= 500);

-- 4. Revoke Default Public/Anonymous Table Access
REVOKE ALL ON TABLE public.tasks FROM anon, public;
REVOKE ALL ON TABLE public.activity_logs FROM anon, public;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_logs TO authenticated;

-- 5. Hardened Server-Side Triggers for Automatic User ID Assignment & Timestamps

-- Function: Force user_id = auth.uid() on INSERT (prevents user_id spoofing)
CREATE OR REPLACE FUNCTION public.handle_force_auth_user_id()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated operation not permitted';
  END IF;
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Automatic updated_at timestamp on UPDATE
CREATE OR REPLACE FUNCTION public.handle_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  -- Prevent changing task ownership (user_id is immutable)
  NEW.user_id := OLD.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach Triggers to Tasks Table
DROP TRIGGER IF EXISTS trg_tasks_force_user_id ON public.tasks;
CREATE TRIGGER trg_tasks_force_user_id
  BEFORE INSERT ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_force_auth_user_id();

DROP TRIGGER IF EXISTS trg_tasks_set_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_set_updated_at();

-- Attach Trigger to Activity Logs Table
DROP TRIGGER IF EXISTS trg_activity_logs_force_user_id ON public.activity_logs;
CREATE TRIGGER trg_activity_logs_force_user_id
  BEFORE INSERT ON public.activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_force_auth_user_id();

-- 6. Hardened Row Level Security (RLS) Policies
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Tasks Policies
DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;

CREATE POLICY "Users can view their own tasks"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks"
  ON public.tasks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tasks"
  ON public.tasks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tasks"
  ON public.tasks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Activity Logs Policies
DROP POLICY IF EXISTS "Users can view their own activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Users can insert their own activity logs" ON public.activity_logs;

CREATE POLICY "Users can view their own activity logs"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own activity logs"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 7. Ensure Optimized Security Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_sec_user_order ON public.tasks (user_id, "order" ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_sec_user_created ON public.tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_sec_user_created ON public.activity_logs (user_id, created_at DESC);

-- 8. Enable Realtime Replication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END $$;
