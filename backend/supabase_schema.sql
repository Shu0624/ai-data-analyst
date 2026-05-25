-- AI Data Analyst — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor to initialize the database

-- Enable the UUID extension
create extension if not exists "uuid-ossp";

-- ==========================================
-- 1. USERS TABLE (Extends Supabase Auth)
-- ==========================================
create table public.users (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  plan_tier text default 'Free', -- 'Free', 'Pro', 'Enterprise'
  query_count integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Protect internal auth data; users can only read/update their own profile
alter table public.users enable row level security;
create policy "Users can view own profile" on public.users for select using (auth.uid() = id);
create policy "Users can update own profile" on public.users for update using (auth.uid() = id);

-- Trigger to automatically create a public.users row when a new user signs up via auth
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ==========================================
-- 2. DATASETS TABLE
-- ==========================================
create table public.datasets (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  file_name text not null,
  file_size_bytes bigint not null,
  row_count integer not null,
  storage_path text not null, -- Links to Supabase Storage bucket
  schema_definition jsonb,    -- Inferred column types (e.g., {"revenue": "number", "date": "string"})
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index for fast user lookups
create index idx_datasets_user_id on public.datasets(user_id);

alter table public.datasets enable row level security;
create policy "Users can view own datasets" on public.datasets for select using (auth.uid() = user_id);
create policy "Users can insert own datasets" on public.datasets for insert with check (auth.uid() = user_id);
create policy "Users can delete own datasets" on public.datasets for delete using (auth.uid() = user_id);


-- ==========================================
-- 3. CHAT SESSIONS TABLE
-- ==========================================
create table public.chat_sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  dataset_id uuid references public.datasets(id) on delete cascade not null,
  session_name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index idx_chat_sessions_user_id on public.chat_sessions(user_id);

alter table public.chat_sessions enable row level security;
create policy "Users can view own sessions" on public.chat_sessions for select using (auth.uid() = user_id);
create policy "Users can insert own sessions" on public.chat_sessions for insert with check (auth.uid() = user_id);
create policy "Users can delete own sessions" on public.chat_sessions for delete using (auth.uid() = user_id);


-- ==========================================
-- 4. MESSAGES TABLE
-- ==========================================
create table public.messages (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references public.chat_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'ai')),
  text_content text not null,
  generated_sql text,     -- Nullable, only present for AI responses that generate SQL
  chart_config jsonb,     -- Nullable, e.g. {"type": "bar", "xAxis": "month", "yAxis": "revenue"}
  insights jsonb,         -- Nullable array of objects
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index for fast session thread retrieval
create index idx_messages_session_id on public.messages(session_id);

alter table public.messages enable row level security;
-- Policy checks if the message belongs to a session owned by the user
create policy "Users can view own messages" on public.messages for select 
using (session_id in (select id from public.chat_sessions where user_id = auth.uid()));

create policy "Users can insert own messages" on public.messages for insert 
with check (session_id in (select id from public.chat_sessions where user_id = auth.uid()));


-- ==========================================
-- 5. STORAGE BUCKET CONFIGURATION
-- ==========================================
-- NOTE: Please ensure you create a storage bucket named "user-datasets" manually in the dashboard or via the API.
-- These queries set the security policies for the "user-datasets" storage bucket.

insert into storage.buckets (id, name, public) 
values ('user-datasets', 'user-datasets', false)
on conflict (id) do nothing;

create policy "Users can upload their own datasets"
on storage.objects for insert
with check (
  bucket_id = 'user-datasets' and
  auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can read their own datasets"
on storage.objects for select
using (
  bucket_id = 'user-datasets' and
  auth.uid()::text = (storage.foldername(name))[1]
);

create policy "Users can delete their own datasets"
on storage.objects for delete
using (
  bucket_id = 'user-datasets' and
  auth.uid()::text = (storage.foldername(name))[1]
);
