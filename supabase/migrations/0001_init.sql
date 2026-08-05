-- Founder Brief — initial schema
-- All tables are written by the server (service role) and readable only by
-- their owner via RLS. Clients never write directly except chat inserts.

create extension if not exists pgcrypto;

-- ── user settings ────────────────────────────────────────────────────
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'UTC',
  send_hour int not null default 7 check (send_hour between 0 and 23),
  email_enabled boolean not null default true,
  goal text,                        -- "what are you focused on right now?"
  last_generate_at timestamptz,     -- rate limit for manual brief generation
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── connected tools ──────────────────────────────────────────────────
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('github', 'supabase', 'plausible', 'stripe')),
  access_token text,                 -- AES-256-GCM encrypted, app-level key
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ── collected facts: one row per user per source per day ─────────────
create table public.daily_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_date date not null,
  source text not null check (source in ('github', 'supabase', 'plausible', 'stripe')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, metric_date, source)
);
create index daily_metrics_user_date on public.daily_metrics (user_id, metric_date desc);

-- ── generated briefs ─────────────────────────────────────────────────
create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_date date not null,          -- the day the brief covers ("yesterday")
  content jsonb not null,
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, brief_date)
);
create index briefs_user_date on public.briefs (user_id, brief_date desc);

-- ── chat history ─────────────────────────────────────────────────────
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index chat_messages_user_created on public.chat_messages (user_id, created_at);

-- ── integration demand capture: which tools users wish we supported ───
create table public.tool_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool text not null,
  created_at timestamptz not null default now(),
  unique (user_id, tool)
);

-- ── RLS: owners read their own rows; server (service role) does writes ─
alter table public.user_settings  enable row level security;
alter table public.integrations   enable row level security;
alter table public.daily_metrics  enable row level security;
alter table public.briefs         enable row level security;
alter table public.chat_messages  enable row level security;
alter table public.tool_requests  enable row level security;

create policy "own settings"  on public.user_settings  for select using (auth.uid() = user_id);
create policy "own integrations" on public.integrations for select using (auth.uid() = user_id);
create policy "own metrics"   on public.daily_metrics  for select using (auth.uid() = user_id);
create policy "own briefs"    on public.briefs         for select using (auth.uid() = user_id);
create policy "own chat"      on public.chat_messages  for select using (auth.uid() = user_id);
create policy "insert own chat" on public.chat_messages for insert with check (auth.uid() = user_id);
create policy "own tool requests" on public.tool_requests for select using (auth.uid() = user_id);
