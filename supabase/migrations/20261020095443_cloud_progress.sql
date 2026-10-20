-- Append-only history. Each activity has a stable UUID so network retries
-- cannot count study minutes, XP, reviews, or exam attempts twice.
create table public.progress_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  event jsonb not null,
  received_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint event_object check (jsonb_typeof(event) = 'object'),
  constraint event_id_matches check ((event ->> 'id' = id::text) is true),
  constraint event_at_present check ((jsonb_typeof(event -> 'at') = 'string') is true),
  constraint event_operation_present check ((jsonb_typeof(event -> 'operation') = 'object') is true),
  constraint event_size check (octet_length(event::text) <= 262144)
);
alter table public.progress_events enable row level security;
revoke all on public.progress_events from public, anon, authenticated;
grant select, insert on public.progress_events to authenticated;
create policy "Read own study history" on public.progress_events for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "Append own study history" on public.progress_events for insert
  to authenticated with check ((select auth.uid()) = user_id);
-- There are deliberately no client UPDATE/DELETE privileges or policies.
-- App updates never recreate this table or overwrite another device's history.
comment on table public.progress_events is 'Account-scoped immutable Florine study activity; clients can only read and append their own rows.';
