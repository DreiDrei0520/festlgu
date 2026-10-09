-- FestivaLGU — Chat support (AI chatbot + human admin escalation)
-- Idempotent: safe to run more than once. Run in the Supabase SQL editor.
--
-- Model: one conversation per user. Messages are sent by 'user', 'bot' or 'admin'.
--  • user messages to the bot go through the server (/api/chat) so they are rate-limited
--  • bot messages are only ever written by the server (service role)
--  • users can read only their own conversation; admins read their town's (plus
--    conversations from users with no town, e.g. tourists)

create table if not exists public.support_conversations (
  id               serial primary key,
  user_id          uuid not null unique references auth.users(id) on delete cascade,
  municipality     text,
  status           text not null default 'open' check (status in ('open','escalated','resolved')),
  escalated_at     timestamptz,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create table if not exists public.support_messages (
  id               serial primary key,
  conversation_id  int not null references public.support_conversations(id) on delete cascade,
  sender           text not null check (sender in ('user','bot','admin')),
  sender_id        uuid references auth.users(id) on delete set null,
  body             text not null check (char_length(body) between 1 and 4000),
  read_by_user     boolean not null default false,
  read_by_admin    boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists support_messages_conv_idx on public.support_messages (conversation_id, created_at);
create index if not exists support_conversations_status_idx on public.support_conversations (status, last_message_at desc);

-- ── helpers ──────────────────────────────────────────────────────────────────

-- Admin who may see a conversation for this town (null town = visible to every admin).
create or replace function public.support_can_admin(target_municipality text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
      and (target_municipality is null
           or p.municipality = target_municipality
           or p.municipality_access @> array[target_municipality])
  );
$$;

-- Read flags and sender are decided here, never by the client; keeps the
-- conversation's ordering / status in step with new messages.
create or replace function public.support_messages_before_insert()
returns trigger language plpgsql as $$
begin
  new.read_by_user  := (new.sender = 'user');
  new.read_by_admin := (new.sender in ('admin','bot'));
  -- browser callers can't spoof the sender id; the server (no auth.uid()) passes it
  if auth.uid() is not null then new.sender_id := auth.uid(); end if;
  if new.sender = 'bot' then new.sender_id := null; end if;
  return new;
end $$;

create or replace function public.support_messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_conversations c
     set last_message_at = new.created_at,
         -- a user writing to a resolved conversation reopens it
         status = case when new.sender = 'user' and c.status = 'resolved' then 'open' else c.status end
   where c.id = new.conversation_id;
  return new;
end $$;

drop trigger if exists support_messages_bi on public.support_messages;
create trigger support_messages_bi before insert on public.support_messages
  for each row execute function public.support_messages_before_insert();
drop trigger if exists support_messages_ai on public.support_messages;
create trigger support_messages_ai after insert on public.support_messages
  for each row execute function public.support_messages_after_insert();

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

drop policy if exists "support conv read" on public.support_conversations;
create policy "support conv read" on public.support_conversations for select
  using (user_id = auth.uid() or public.support_can_admin(municipality));

drop policy if exists "support conv insert own" on public.support_conversations;
create policy "support conv insert own" on public.support_conversations for insert
  with check (user_id = auth.uid() and status = 'open');
-- No client update/delete policy: status changes go through the RPCs below.

drop policy if exists "support msg read" on public.support_messages;
create policy "support msg read" on public.support_messages for select
  using (exists (select 1 from public.support_conversations c
                 where c.id = conversation_id
                   and (c.user_id = auth.uid() or public.support_can_admin(c.municipality))));

-- Users may write 'user' messages in their own conversation; admins 'admin' messages.
-- 'bot' messages are written by the server with the service role only.
drop policy if exists "support msg insert" on public.support_messages;
create policy "support msg insert" on public.support_messages for insert
  with check (
    (sender = 'user' and exists (select 1 from public.support_conversations c
                                 where c.id = conversation_id and c.user_id = auth.uid()))
    or
    (sender = 'admin' and exists (select 1 from public.support_conversations c
                                  where c.id = conversation_id and public.support_can_admin(c.municipality)))
  );

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- Hand the conversation to a human and leave a note in the thread.
create or replace function public.support_escalate()
returns void language plpgsql security definer set search_path = public as $$
declare cid int;
begin
  select id into cid from public.support_conversations where user_id = auth.uid();
  if cid is null then raise exception 'No conversation'; end if;
  update public.support_conversations
     set status = 'escalated', escalated_at = now() where id = cid;
  insert into public.support_messages (conversation_id, sender, body)
  values (cid, 'bot', 'I''ve passed this conversation to the tourism office. An admin will reply here as soon as they can — you can keep typing in the meantime.');
end $$;

-- Mark everything the caller can see as read (user side or admin side).
create or replace function public.support_mark_read(p_conversation int)
returns void language plpgsql security definer set search_path = public as $$
declare c public.support_conversations;
begin
  select * into c from public.support_conversations where id = p_conversation;
  if c.id is null then return; end if;
  if c.user_id = auth.uid() then
    update public.support_messages set read_by_user = true
     where conversation_id = c.id and not read_by_user;
  elsif public.support_can_admin(c.municipality) then
    update public.support_messages set read_by_admin = true
     where conversation_id = c.id and not read_by_admin;
  end if;
end $$;

-- Admin only: open / escalated / resolved.
create or replace function public.support_set_status(p_conversation int, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.support_conversations;
begin
  if p_status not in ('open','escalated','resolved') then raise exception 'Bad status'; end if;
  select * into c from public.support_conversations where id = p_conversation;
  if c.id is null or not public.support_can_admin(c.municipality) then
    raise exception 'Not allowed';
  end if;
  update public.support_conversations set status = p_status where id = c.id;
end $$;

grant execute on function public.support_escalate() to authenticated;
grant execute on function public.support_mark_read(int) to authenticated;
grant execute on function public.support_set_status(int, text) to authenticated;

-- ── realtime ─────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['support_messages','support_conversations'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

select public.sync_id_sequences();
notify pgrst, 'reload schema';
