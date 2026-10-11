-- Guardian for a Day: optional shared store for anonymous community records (Supabase / PostgreSQL).
-- Run once in the Supabase SQL editor, then build the game with VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY (see README). Without it the game keeps everything on each device.
--
-- What is stored: the monument, level, sensor counts, score, whether the replayed alarm was caught,
-- quiz right/wrong marks, the date (no time) and an optional class code. No names, no device ids,
-- no IP addresses (Supabase keeps its own request logs; see its privacy terms).
--
-- The public "anon" key may only INSERT and SELECT. There are no UPDATE or DELETE policies, so nobody
-- with the public key can change or remove records. CHECK constraints keep rows small and well-formed.

create table if not exists public.plays (
  id bigint generated always as identity primary key,
  monument text not null check (monument ~ '^[a-z]{3,20}$'),
  level text not null check (level in ('low', 'medium', 'high', 'extreme', 'catastrophic')),
  picks jsonb not null check (jsonb_typeof(picks) = 'object' and pg_column_size(picks) < 2000),
  score smallint not null check (score between 0 and 100),
  detected boolean not null,
  day date not null check (day between date '2026-01-01' and current_date + 1),
  class_code text check (class_code ~ '^[A-HJ-NP-Z2-9]{6}$')
);
create index if not exists plays_monument_level on public.plays (monument, level);
create index if not exists plays_class_code on public.plays (class_code);

create table if not exists public.quizzes (
  id bigint generated always as identity primary key,
  monument text not null check (monument ~ '^[a-z]{3,20}$'),
  pre jsonb check (pre is null or (jsonb_typeof(pre) = 'array' and jsonb_array_length(pre) <= 20)),
  post jsonb not null check (jsonb_typeof(post) = 'array' and jsonb_array_length(post) <= 20),
  day date not null check (day between date '2026-01-01' and current_date + 1),
  class_code text check (class_code ~ '^[A-HJ-NP-Z2-9]{6}$')
);
create index if not exists quizzes_class_code on public.quizzes (class_code);

alter table public.plays enable row level security;
alter table public.quizzes enable row level security;

drop policy if exists "anyone can add an anonymous play" on public.plays;
create policy "anyone can add an anonymous play" on public.plays for insert to anon with check (true);
drop policy if exists "anyone can read plays" on public.plays;
create policy "anyone can read plays" on public.plays for select to anon using (true);

drop policy if exists "anyone can add anonymous quiz answers" on public.quizzes;
create policy "anyone can add anonymous quiz answers" on public.quizzes for insert to anon with check (true);
drop policy if exists "anyone can read quiz answers" on public.quizzes;
create policy "anyone can read quiz answers" on public.quizzes for select to anon using (true);
