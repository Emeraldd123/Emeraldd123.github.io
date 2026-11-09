-- Portfolio visitor analytics, stored in Pipit's Supabase project but kept apart from the app:
-- its own `portfolio` schema (Prisma only manages `public`), and the browser can only call one
-- insert-only function. The anon key cannot read anything back.
-- Safe to re-run.

create schema if not exists portfolio;

create table if not exists portfolio.events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  session_id  text not null check (char_length(session_id) between 8 and 64),
  visitor_id  text not null check (char_length(visitor_id) between 8 and 64),
  type        text not null check (type in ('visit', 'section', 'click', 'video', 'heartbeat', 'leave', 'intro')),
  data        jsonb not null default '{}'::jsonb check (pg_column_size(data) < 4000)
);
create index if not exists events_session_idx on portfolio.events (session_id, created_at);
create index if not exists events_created_idx on portfolio.events (created_at desc);

-- Lock the schema down: nothing is reachable through the REST API except the function below.
alter table portfolio.events enable row level security;
revoke all on schema portfolio from anon, authenticated;
revoke all on all tables in schema portfolio from anon, authenticated;

-- The only thing the website can do: append one event.
create or replace function public.portfolio_track(p_session text, p_visitor text, p_type text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = portfolio, pg_temp
as $$
begin
  -- Cheap abuse guard: at most 300 events per session.
  if (select count(*) from portfolio.events where session_id = p_session) >= 300 then
    return;
  end if;
  insert into portfolio.events (session_id, visitor_id, type, data)
  values (p_session, p_visitor, p_type, coalesce(p_data, '{}'::jsonb));
end;
$$;
revoke all on function public.portfolio_track(text, text, text, jsonb) from public;
grant execute on function public.portfolio_track(text, text, text, jsonb) to anon;

-- One row per visit, for reading in the Supabase dashboard (Table editor → schema "portfolio").
drop view if exists portfolio.visits;
create view portfolio.visits as
with per_visitor as (
  select visitor_id, count(distinct session_id) as visits_by_this_visitor
  from portfolio.events group by visitor_id
), s as (
select
  e.session_id,
  min(e.created_at)                                                          as started_at,
  max(e.created_at)                                                          as last_seen,
  round(extract(epoch from max(e.created_at) - min(e.created_at)))::int      as seconds_on_site,
  max(e.visitor_id)                                                          as visitor_id,
  max(e.data->>'org')      filter (where e.type = 'visit')                   as network_org,
  max(e.data->>'city')     filter (where e.type = 'visit')                   as city,
  max(e.data->>'region')   filter (where e.type = 'visit')                   as region,
  max(e.data->>'country')  filter (where e.type = 'visit')                   as country,
  max(e.data->>'referrer') filter (where e.type = 'visit')                   as referrer,
  max(e.data->>'ref')      filter (where e.type = 'visit')                   as ref,
  bool_or((e.data->>'ref_returning')::boolean) filter (where e.type = 'visit') as ref_returning,
  max(e.data->>'utm')      filter (where e.type = 'visit')                   as utm,
  max(e.data->>'device')   filter (where e.type = 'visit')                   as device,
  max(e.data->>'browser')  filter (where e.type = 'visit')                   as browser,
  max(e.data->>'tz')       filter (where e.type = 'visit')                   as timezone,
  max(e.data->>'name')     filter (where e.type = 'intro')                   as intro_name,
  max(e.data->>'company')  filter (where e.type = 'intro')                   as intro_company,
  max(e.data->>'role')     filter (where e.type = 'intro')                   as intro_role,
  max(e.data->>'email')    filter (where e.type = 'intro')                   as intro_email,
  max(e.data->>'note')     filter (where e.type = 'intro')                   as intro_note,
  max(e.data->>'linkedin') filter (where e.type = 'intro')                   as intro_linkedin,
  bool_or(e.type = 'click' and e.data->>'target' = 'resume')                 as resume_clicked,
  (array_agg(e.data->'dwell' order by e.created_at desc) filter (where e.type in ('heartbeat', 'leave') and e.data ? 'dwell'))[1] as dwell_seconds,
  string_agg(distinct e.data->>'section', ', ') filter (where e.type = 'section') as sections_seen,
  string_agg(distinct e.data->>'target', ', ')  filter (where e.type = 'click')   as clicked,
  string_agg(distinct e.data->>'video', ', ')   filter (where e.type = 'video')   as videos_watched,
  max((e.data->>'scroll')::int) filter (where e.type in ('heartbeat', 'leave'))    as max_scroll_pct,
  -- Rough "is this a recruiter?" signal: they reached contact/experience or clicked contact links.
  (bool_or(e.type = 'intro')
     or bool_or(e.type = 'click' and e.data->>'target' in ('email', 'linkedin', 'resume'))
     or bool_or(e.type = 'visit' and coalesce(e.data->>'ref', '') <> '')
     or bool_or(e.type = 'section' and e.data->>'section' in ('experience', 'contact'))) as warm_lead
from portfolio.events e
group by e.session_id
)
select s.*, v.visits_by_this_visitor
from s join per_visitor v using (visitor_id)
order by s.started_at desc;
revoke all on portfolio.visits from anon, authenticated;
