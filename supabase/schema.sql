-- ============================================================
-- FishTracker App — Schema Bază de Date
-- Rulează în Supabase Dashboard → SQL Editor
-- ============================================================

-- Activează extensia UUID
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS (profiluri utilizatori)
-- ============================================================
create table if not exists public.profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  username     text unique not null,
  full_name    text,
  avatar_url   text,
  bio          text,
  role         text not null default 'user' check (role in ('user', 'admin')),
  created_at   timestamptz default now()
);

alter table public.profiles
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
end
$$;

-- Creare automată profil la înregistrare
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- PASSWORD RESET CODES (coduri resetare parola)
-- ============================================================
create table if not exists public.password_reset_codes (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references auth.users(id) on delete cascade not null,
  email         text not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  attempt_count int not null default 0,
  created_at    timestamptz default now()
);

create index if not exists idx_password_reset_codes_user_created_at
  on public.password_reset_codes (user_id, created_at desc);

create index if not exists idx_password_reset_codes_email_created_at
  on public.password_reset_codes (email, created_at desc);

create or replace function public.find_user_for_password_reset(lookup_email text)
returns table (
  user_id uuid,
  email text,
  username text,
  full_name text
)
language sql
security definer
set search_path = public, auth
as $$
  select
    u.id as user_id,
    u.email::text as email,
    p.username,
    p.full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email::text) = lower(trim(lookup_email))
  limit 1;
$$;

-- ============================================================
-- BAIT PRESETS (momeli predefinite — readonly)
-- ============================================================
create table if not exists public.bait_presets (
  id       serial primary key,
  name     text not null,
  category text not null check (category in ('boilie','pellet','porumb','vierme','lipitoare','aluat','custom'))
);

-- Populare cu date inițiale
insert into public.bait_presets (name, category) values
  ('Boilie Tutti-Frutti 20mm',  'boilie'),
  ('Boilie Strawberry 18mm',    'boilie'),
  ('Boilie Fishmeal 24mm',      'boilie'),
  ('Boilie Scopex 20mm',        'boilie'),
  ('Boilie Squid & Octopus',    'boilie'),
  ('Boilie Monster Crab',       'boilie'),
  ('Pellet Crap 6mm',           'pellet'),
  ('Pellet Crap 8mm',           'pellet'),
  ('Pellet Sturion 6mm',        'pellet'),
  ('Pellet Halibut 6mm',        'pellet'),
  ('Porumb natural',            'porumb'),
  ('Porumb fermentat',          'porumb'),
  ('Porumb colorat (galben)',   'porumb'),
  ('Vierme roșu',               'vierme'),
  ('Vierme de nămol',           'vierme'),
  ('Lipitoare',                 'lipitoare'),
  ('Aluat clasic',              'aluat'),
  ('Aluat cu vanilie',          'aluat'),
  ('Custom / Altul',            'custom')
on conflict do nothing;

-- ============================================================
-- LOCATIONS (lacuri / bălți)
-- ============================================================
create table if not exists public.locations (
  id           uuid default uuid_generate_v4() primary key,
  created_by   uuid references public.profiles(id) on delete set null,
  name         text not null,
  description  text,
  lat          double precision not null,
  lng          double precision not null,
  photo_url    text,
  is_public    boolean default true,
  created_at   timestamptz default now()
);

-- ============================================================
-- SESSIONS (partide de pescuit)
-- ============================================================
create table if not exists public.sessions (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references public.profiles(id) on delete cascade not null,
  location_id      uuid references public.locations(id) on delete set null,
  started_at       timestamptz default now(),
  ended_at         timestamptz,
  weather_snapshot jsonb,         -- snapshot meteo la momentul pornirii
  notes            text,
  is_active        boolean default true
);

-- ============================================================
-- RODS (lansete per sesiune)
-- ============================================================
create table if not exists public.rods (
  id             uuid default uuid_generate_v4() primary key,
  session_id     uuid references public.sessions(id) on delete cascade not null,
  rod_number     int not null check (rod_number between 1 and 4),
  bait_preset_id int references public.bait_presets(id) on delete set null,
  bait_custom    text,            -- dacă nu e din preseturi
  hook_setup     text,            -- montură / cârlig
  cast_count     int default 0,
  last_cast_at   timestamptz,
  catch_count    int default 0,
  offline_data   jsonb,           -- date locale nesinc
  updated_at     timestamptz default now(),
  unique (session_id, rod_number)
);

-- ============================================================
-- ROD SETUP HISTORY (istoric nada / montura per lanseta)
-- ============================================================
create table if not exists public.rod_setup_history (
  id          uuid default uuid_generate_v4() primary key,
  session_id  uuid references public.sessions(id) on delete cascade not null,
  rod_id      uuid references public.rods(id) on delete set null,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  rod_number  int not null check (rod_number between 1 and 4),
  bait_name   text,
  hook_setup  text,
  created_at  timestamptz default now()
);

-- ============================================================
-- CATCHES (capturi)
-- ============================================================
create table if not exists public.catches (
  id           uuid default uuid_generate_v4() primary key,
  session_id   uuid references public.sessions(id) on delete cascade not null,
  rod_id       uuid references public.rods(id) on delete set null,
  user_id      uuid references public.profiles(id) on delete cascade not null,
  location_id  uuid references public.locations(id) on delete set null,
  group_id     uuid references public.groups(id) on delete set null,
  fish_species text,
  weight_kg    double precision,
  length_cm    double precision,
  photo_url    text,
  is_returned  boolean default true,   -- catch & release
  caught_at    timestamptz default now(),
  notes        text
);

alter table public.catches
  add column if not exists group_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catches_group_id_fkey'
  ) then
    alter table public.catches
      add constraint catches_group_id_fkey
      foreign key (group_id) references public.groups(id) on delete set null;
  end if;
end
$$;

-- ============================================================
-- GROUPS (grupuri private)
-- ============================================================
create table if not exists public.groups (
  id           uuid default uuid_generate_v4() primary key,
  owner_id     uuid references public.profiles(id) on delete cascade not null,
  name         text not null,
  description  text,
  invite_code  text unique default upper(substring(md5(random()::text) from 1 for 8)),
  avatar_url   text,
  is_private   boolean default true,
  created_at   timestamptz default now()
);

-- ============================================================
-- GROUP MEMBERS
-- ============================================================
create table if not exists public.group_members (
  id         uuid default uuid_generate_v4() primary key,
  group_id   uuid references public.groups(id) on delete cascade not null,
  user_id    uuid references public.profiles(id) on delete cascade not null,
  role       text default 'member' check (role in ('owner', 'member')),
  last_read_at timestamptz,
  joined_at  timestamptz default now(),
  unique (group_id, user_id)
);

alter table public.group_members
  add column if not exists last_read_at timestamptz;

-- ============================================================
-- GROUP PHOTOS (galerie grup)
-- ============================================================
create table if not exists public.group_photos (
  id           uuid default uuid_generate_v4() primary key,
  group_id     uuid references public.groups(id) on delete cascade not null,
  uploaded_by  uuid references public.profiles(id) on delete set null,
  photo_url    text not null,
  caption      text,
  created_at   timestamptz default now()
);

-- ============================================================
-- MESSAGES (chat global)
-- ============================================================
create table if not exists public.messages (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  content    text,
  media_url  text,
  created_at timestamptz default now()
);

-- ============================================================
-- PRIVATE CONVERSATIONS
-- ============================================================
create table if not exists public.private_conversations (
  id         uuid default uuid_generate_v4() primary key,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.private_conversation_members (
  id              uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.private_conversations(id) on delete cascade not null,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  last_read_at    timestamptz,
  joined_at       timestamptz default now(),
  unique (conversation_id, user_id)
);

alter table public.private_conversation_members
  add column if not exists last_read_at timestamptz;

create table if not exists public.private_messages (
  id              uuid default uuid_generate_v4() primary key,
  conversation_id uuid references public.private_conversations(id) on delete cascade not null,
  user_id         uuid references public.profiles(id) on delete set null,
  content         text,
  media_url       text,
  created_at      timestamptz default now()
);

-- ============================================================
-- GROUP MESSAGES
-- ============================================================
create table if not exists public.group_messages (
  id         uuid default uuid_generate_v4() primary key,
  group_id    uuid references public.groups(id) on delete cascade not null,
  user_id     uuid references public.profiles(id) on delete set null,
  content     text,
  media_url   text,
  created_at  timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table public.profiles      enable row level security;
alter table public.password_reset_codes enable row level security;
alter table public.locations     enable row level security;
alter table public.sessions      enable row level security;
alter table public.rods          enable row level security;
alter table public.rod_setup_history enable row level security;
alter table public.catches       enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.group_photos  enable row level security;
alter table public.messages      enable row level security;
alter table public.private_conversations enable row level security;
alter table public.private_conversation_members enable row level security;
alter table public.private_messages enable row level security;
alter table public.group_messages enable row level security;

create or replace function public.is_admin(check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = check_user_id and p.role = 'admin'
  );
$$;

create or replace function public.is_group_member(check_group_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = check_group_id and gm.user_id = check_user_id
  );
$$;

create or replace function public.is_private_conversation_member(check_conversation_id uuid, check_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.private_conversation_members pcm
    where pcm.conversation_id = check_conversation_id and pcm.user_id = check_user_id
  );
$$;

create or replace function public.create_or_get_private_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_conversation_id uuid;
  new_conversation_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if other_user_id is null or other_user_id = current_user_id then
    raise exception 'Invalid other user';
  end if;

  select pcm.conversation_id
  into existing_conversation_id
  from public.private_conversation_members pcm
  where pcm.user_id = current_user_id
    and exists (
      select 1
      from public.private_conversation_members other_member
      where other_member.conversation_id = pcm.conversation_id
        and other_member.user_id = other_user_id
    )
    and (
      select count(*)
      from public.private_conversation_members member_count
      where member_count.conversation_id = pcm.conversation_id
    ) = 2
  limit 1;

  if existing_conversation_id is not null then
    return existing_conversation_id;
  end if;

  insert into public.private_conversations (created_by)
  values (current_user_id)
  returning id into new_conversation_id;

  insert into public.private_conversation_members (conversation_id, user_id)
  values
    (new_conversation_id, current_user_id),
    (new_conversation_id, other_user_id)
  on conflict do nothing;

  return new_conversation_id;
end;
$$;

create or replace function public.get_group_by_invite_code(invite_code_input text)
returns table (
  id uuid,
  owner_id uuid,
  name text,
  description text,
  invite_code text,
  avatar_url text,
  is_private boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    g.id,
    g.owner_id,
    g.name,
    g.description,
    g.invite_code,
    g.avatar_url,
    g.is_private,
    g.created_at
  from public.groups g
  where upper(trim(g.invite_code)) = upper(trim(invite_code_input))
  limit 1;
$$;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_private_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.create_or_get_private_conversation(uuid) to authenticated;
grant execute on function public.get_group_by_invite_code(text) to authenticated;
revoke all on function public.find_user_for_password_reset(text) from public;
revoke all on function public.find_user_for_password_reset(text) from anon;
revoke all on function public.find_user_for_password_reset(text) from authenticated;
grant execute on function public.find_user_for_password_reset(text) to service_role;

create or replace function public.get_leaderboard_monthly()
returns table (
  user_id uuid,
  username text,
  avatar_url text,
  total_catches bigint,
  biggest_fish_kg double precision,
  total_weight_kg double precision,
  total_sessions bigint
)
language sql
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    p.username,
    p.avatar_url,
    count(c.id) as total_catches,
    coalesce(max(c.weight_kg), 0) as biggest_fish_kg,
    coalesce(sum(c.weight_kg), 0) as total_weight_kg,
    count(distinct c.session_id) as total_sessions
  from public.catches c
  join public.profiles p on p.id = c.user_id
  where c.caught_at >= date_trunc('month', now())
  group by p.id, p.username, p.avatar_url
  order by count(c.id) desc, coalesce(max(c.weight_kg), 0) desc, coalesce(sum(c.weight_kg), 0) desc;
$$;

grant execute on function public.get_leaderboard_monthly() to authenticated;

-- Profiles: toată lumea vede, doar tu editezi al tău
drop policy if exists "Public profiles viewable" on public.profiles;
create policy "Public profiles viewable" on public.profiles for select using (true);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update using (
  auth.uid() = id or public.is_admin(auth.uid())
) with check (
  auth.uid() = id or public.is_admin(auth.uid())
);

-- Locations: publice vizibile de toți, creare autentificați
drop policy if exists "Public locations viewable" on public.locations;
create policy "Public locations viewable" on public.locations for select using (
  is_public = true or auth.uid() = created_by or public.is_admin(auth.uid())
);
drop policy if exists "Authenticated users create locations" on public.locations;
create policy "Authenticated users create locations" on public.locations for insert with check (
  auth.uid() = created_by or public.is_admin(auth.uid())
);
drop policy if exists "Owners or admins update locations" on public.locations;
create policy "Owners or admins update locations" on public.locations for update using (
  auth.uid() = created_by or public.is_admin(auth.uid())
) with check (
  auth.uid() = created_by or public.is_admin(auth.uid())
);
drop policy if exists "Owners or admins delete locations" on public.locations;
create policy "Owners or admins delete locations" on public.locations for delete using (
  auth.uid() = created_by or public.is_admin(auth.uid())
);

-- Sessions: doar propriile sesiuni
drop policy if exists "Own sessions only" on public.sessions;
create policy "Own sessions only" on public.sessions for all using (
  auth.uid() = user_id or public.is_admin(auth.uid())
) with check (
  auth.uid() = user_id or public.is_admin(auth.uid())
);

-- Rods: prin sesiunile proprii
drop policy if exists "Own rods via session" on public.rods;
create policy "Own rods via session" on public.rods for all using (
  public.is_admin(auth.uid())
  or exists (select 1 from public.sessions s where s.id = rods.session_id and s.user_id = auth.uid())
) with check (
  public.is_admin(auth.uid())
  or exists (select 1 from public.sessions s where s.id = rods.session_id and s.user_id = auth.uid())
);

-- Rod setup history: doar propriul istoric sau admin
drop policy if exists "Own rod setup history" on public.rod_setup_history;
create policy "Own rod setup history" on public.rod_setup_history for select using (
  auth.uid() = user_id or public.is_admin(auth.uid())
);
drop policy if exists "Users insert own rod setup history" on public.rod_setup_history;
create policy "Users insert own rod setup history" on public.rod_setup_history for insert with check (
  auth.uid() = user_id or public.is_admin(auth.uid())
);

-- Catches: proprii + publice per locație
drop policy if exists "Own catches" on public.catches;
create policy "Own catches" on public.catches for all using (
  auth.uid() = user_id or public.is_admin(auth.uid())
) with check (
  auth.uid() = user_id or public.is_admin(auth.uid())
);
drop policy if exists "Public catches on public locations" on public.catches;
create policy "Public catches on public locations" on public.catches for select using (
  public.is_admin(auth.uid())
  or exists (select 1 from public.locations l where l.id = catches.location_id and l.is_public = true)
);
drop policy if exists "Group members view group catches" on public.catches;
create policy "Group members view group catches" on public.catches for select using (
  catches.group_id is not null
  and (
    public.is_admin(auth.uid())
    or public.is_group_member(catches.group_id, auth.uid())
    or exists (
      select 1 from public.groups g
      where g.id = catches.group_id and g.owner_id = auth.uid()
    )
  )
);

-- Groups: membri văd grupul
drop policy if exists "Group members view group" on public.groups;
create policy "Group members view group" on public.groups for select using (
  public.is_admin(auth.uid())
  or
  public.is_group_member(groups.id, auth.uid())
  or owner_id = auth.uid()
);
drop policy if exists "Create groups" on public.groups;
create policy "Create groups" on public.groups for insert with check (auth.uid() = owner_id);
drop policy if exists "Owners or admins update groups" on public.groups;
create policy "Owners or admins update groups" on public.groups for update using (
  owner_id = auth.uid() or public.is_admin(auth.uid())
) with check (
  owner_id = auth.uid() or public.is_admin(auth.uid())
);
drop policy if exists "Owners or admins delete groups" on public.groups;
create policy "Owners or admins delete groups" on public.groups for delete using (
  owner_id = auth.uid() or public.is_admin(auth.uid())
);

-- Group members
drop policy if exists "Members view group_members" on public.group_members;
create policy "Members view group_members" on public.group_members for select using (
  public.is_admin(auth.uid())
  or
  auth.uid() = user_id
  or exists (
    select 1 from public.groups g
    where g.id = group_members.group_id and g.owner_id = auth.uid()
  )
  or public.is_group_member(group_members.group_id, auth.uid())
);
drop policy if exists "Join groups" on public.group_members;
create policy "Join groups" on public.group_members for insert with check (auth.uid() = user_id);
drop policy if exists "Members update own group membership state" on public.group_members;
create policy "Members update own group membership state" on public.group_members for update using (
  public.is_admin(auth.uid()) or auth.uid() = user_id
) with check (
  public.is_admin(auth.uid()) or auth.uid() = user_id
);
drop policy if exists "Owners or admins remove group members" on public.group_members;
create policy "Owners or admins remove group members" on public.group_members for delete using (
  public.is_admin(auth.uid())
  or exists (
    select 1 from public.groups g
    where g.id = group_members.group_id and g.owner_id = auth.uid()
  )
  or auth.uid() = user_id
);

-- Group photos
drop policy if exists "Members view photos" on public.group_photos;
create policy "Members view photos" on public.group_photos for select using (
  public.is_admin(auth.uid())
  or
  public.is_group_member(group_photos.group_id, auth.uid())
  or exists (
    select 1 from public.groups g
    where g.id = group_photos.group_id and g.owner_id = auth.uid()
  )
);
drop policy if exists "Members upload photos" on public.group_photos;
create policy "Members upload photos" on public.group_photos for insert with check (
  (auth.uid() = uploaded_by or public.is_admin(auth.uid())) and
  (
    public.is_admin(auth.uid())
    or
    public.is_group_member(group_photos.group_id, auth.uid())
    or exists (
      select 1 from public.groups g
      where g.id = group_photos.group_id and g.owner_id = auth.uid()
    )
  )
);
drop policy if exists "Owners or admins delete photos" on public.group_photos;
create policy "Owners or admins delete photos" on public.group_photos for delete using (
  public.is_admin(auth.uid())
  or exists (
    select 1 from public.groups g
    where g.id = group_photos.group_id and g.owner_id = auth.uid()
  )
  or uploaded_by = auth.uid()
);

-- Messages: toți autentificații
drop policy if exists "Authenticated view messages" on public.messages;
create policy "Authenticated view messages" on public.messages for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated send messages" on public.messages;
create policy "Authenticated send messages" on public.messages for insert with check (auth.uid() = user_id);
drop policy if exists "Owners or admins update messages" on public.messages;
create policy "Owners or admins update messages" on public.messages for update using (
  auth.uid() = user_id or public.is_admin(auth.uid())
) with check (
  auth.uid() = user_id or public.is_admin(auth.uid())
);
drop policy if exists "Owners or admins delete messages" on public.messages;
create policy "Owners or admins delete messages" on public.messages for delete using (
  auth.uid() = user_id or public.is_admin(auth.uid())
);

-- Private conversations
drop policy if exists "Members view private conversations" on public.private_conversations;
create policy "Members view private conversations" on public.private_conversations for select using (
  public.is_admin(auth.uid())
  or public.is_private_conversation_member(private_conversations.id, auth.uid())
);

drop policy if exists "Members view private conversation members" on public.private_conversation_members;
create policy "Members view private conversation members" on public.private_conversation_members for select using (
  public.is_admin(auth.uid())
  or auth.uid() = user_id
  or public.is_private_conversation_member(private_conversation_members.conversation_id, auth.uid())
);
drop policy if exists "Members update own private conversation state" on public.private_conversation_members;
create policy "Members update own private conversation state" on public.private_conversation_members for update using (
  public.is_admin(auth.uid()) or auth.uid() = user_id
) with check (
  public.is_admin(auth.uid()) or auth.uid() = user_id
);

drop policy if exists "Members view private messages" on public.private_messages;
create policy "Members view private messages" on public.private_messages for select using (
  public.is_admin(auth.uid())
  or public.is_private_conversation_member(private_messages.conversation_id, auth.uid())
);

drop policy if exists "Members send private messages" on public.private_messages;
create policy "Members send private messages" on public.private_messages for insert with check (
  auth.uid() = user_id
  and public.is_private_conversation_member(private_messages.conversation_id, auth.uid())
);

drop policy if exists "Owners or admins update private messages" on public.private_messages;
create policy "Owners or admins update private messages" on public.private_messages for update using (
  auth.uid() = user_id or public.is_admin(auth.uid())
) with check (
  auth.uid() = user_id or public.is_admin(auth.uid())
);

drop policy if exists "Owners or admins delete private messages" on public.private_messages;
create policy "Owners or admins delete private messages" on public.private_messages for delete using (
  auth.uid() = user_id or public.is_admin(auth.uid())
);

-- Group messages
drop policy if exists "Members view group messages" on public.group_messages;
create policy "Members view group messages" on public.group_messages for select using (
  public.is_admin(auth.uid())
  or public.is_group_member(group_messages.group_id, auth.uid())
  or exists (
    select 1 from public.groups g where g.id = group_messages.group_id and g.owner_id = auth.uid()
  )
);

drop policy if exists "Members send group messages" on public.group_messages;
create policy "Members send group messages" on public.group_messages for insert with check (
  auth.uid() = user_id
  and (
    public.is_admin(auth.uid())
    or public.is_group_member(group_messages.group_id, auth.uid())
    or exists (
      select 1 from public.groups g where g.id = group_messages.group_id and g.owner_id = auth.uid()
    )
  )
);

drop policy if exists "Owners or admins update group messages" on public.group_messages;
create policy "Owners or admins update group messages" on public.group_messages for update using (
  auth.uid() = user_id or public.is_admin(auth.uid())
) with check (
  auth.uid() = user_id or public.is_admin(auth.uid())
);

drop policy if exists "Owners or admins delete group messages" on public.group_messages;
create policy "Owners or admins delete group messages" on public.group_messages for delete using (
  auth.uid() = user_id or public.is_admin(auth.uid())
);

-- Bait presets: read-only pentru toți
drop policy if exists "Anyone reads baits" on public.bait_presets;
create policy "Anyone reads baits" on public.bait_presets for select using (true);

-- ============================================================
-- LEADERBOARD VIEW
-- ============================================================
create or replace view public.leaderboard_monthly as
select *
from public.get_leaderboard_monthly();
