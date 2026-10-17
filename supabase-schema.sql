-- ============================================================
-- RUN FOR YOUR LIFE - Supabase Database & Realtime Schema
-- Designed & Developed by Shopifydevstudio
-- ============================================================

-- 1. Create Rooms Table
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  host_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'LOBBY', -- 'LOBBY', 'HEAD_START', 'HUNT', 'ENDED'
  arena JSONB NOT NULL DEFAULT '{"lat": 37.7749, "lng": -122.4194, "radius": 300}',
  settings JSONB NOT NULL DEFAULT '{"roundLength": 2700, "headStart": 180, "pingInterval": 300}',
  winner TEXT,
  time_remaining INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create Players Table
CREATE TABLE IF NOT EXISTS public.players (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES public.rooms(code) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role_preference TEXT NOT NULL DEFAULT 'random',
  assigned_role TEXT, -- 'hunter' | 'runner'
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  is_tagged BOOLEAN NOT NULL DEFAULT FALSE,
  tagged_at TIMESTAMPTZ,
  tagged_by TEXT,
  connected BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Pings History Table
CREATE TABLE IF NOT EXISTS public.pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL REFERENCES public.rooms(code) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  runner_pings JSONB NOT NULL
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pings ENABLE ROW LEVEL SECURITY;

-- 5. Open RLS Policies for Game Access (Anon key can read & write room events)
CREATE POLICY "Public rooms access" ON public.rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public players access" ON public.players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public pings access" ON public.pings FOR ALL USING (true) WITH CHECK (true);

-- 6. Enable Realtime Replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pings;
