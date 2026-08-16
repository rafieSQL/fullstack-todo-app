-- ============================================================================
-- Chronos Calendar Events Schema & Security Hardening
-- Execute in Supabase SQL Editor: https://supabase.com/dashboard/project/xfofsglaaldtyflaxciq/sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  title VARCHAR(250) NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 250),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL CHECK (end_time > start_time),
  category VARCHAR(50) NOT NULL DEFAULT 'General' CHECK (category IN ('General', 'Engineering', 'Design', 'Personal')),
  priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  auto_morph BOOLEAN NOT NULL DEFAULT true,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  event_type VARCHAR(20) NOT NULL DEFAULT 'task' CHECK (event_type IN ('task', 'routine')),
  recurrence VARCHAR(20) NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migration safety for existing tables
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) NOT NULL DEFAULT 'task';
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS recurrence VARCHAR(20) NOT NULL DEFAULT 'none';

-- Revoke default public permissions & grant to authenticated users
REVOKE ALL ON TABLE public.calendar_events FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.calendar_events TO authenticated;

-- Enable Row Level Security (RLS)
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- Hardened RLS Policies
DROP POLICY IF EXISTS "Users can read own calendar events" ON public.calendar_events;
CREATE POLICY "Users can read own calendar events"
  ON public.calendar_events
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own calendar events" ON public.calendar_events;
CREATE POLICY "Users can insert own calendar events"
  ON public.calendar_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own calendar events" ON public.calendar_events;
CREATE POLICY "Users can update own calendar events"
  ON public.calendar_events
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own calendar events" ON public.calendar_events;
CREATE POLICY "Users can delete own calendar events"
  ON public.calendar_events
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Trigger to force user_id = auth.uid()
CREATE OR REPLACE FUNCTION public.handle_force_calendar_user_id()
RETURNS TRIGGER AS $$
BEGIN
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_force_calendar_user_id ON public.calendar_events;
CREATE TRIGGER trg_force_calendar_user_id
  BEFORE INSERT ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_force_calendar_user_id();

-- Trigger for auto updated_at
DROP TRIGGER IF EXISTS trg_calendar_updated_at ON public.calendar_events;
CREATE TRIGGER trg_calendar_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_set_updated_at();

-- High-performance B-tree indexes
CREATE INDEX IF NOT EXISTS idx_calendar_user_time 
  ON public.calendar_events (user_id, start_time ASC);

CREATE INDEX IF NOT EXISTS idx_calendar_task 
  ON public.calendar_events (task_id);
