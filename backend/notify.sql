-- Email Ben the moment someone leaves their LinkedIn or a "Say hi" message on the portfolio.
-- Uses Pipit's Resend account. The API key and sender live in Supabase Vault
-- (secrets 'portfolio_resend_key' and 'portfolio_email_from'), set by backend/setup-alerts.cjs,
-- never in this repo. Safe to re-run.

create extension if not exists pg_net;

create or replace function portfolio.notify_lead()
returns trigger
language plpgsql
security definer
set search_path = portfolio, pg_temp
as $$
declare
  k       text;
  sender  text;
  v       record;
  who     text;
  subj    text;
  body    text;
begin
  if new.type <> 'intro' then return new; end if;
  -- No alerts for Ben's own browsers (marked with ?me=1)
  if exists (select 1 from portfolio.events where visitor_id = new.visitor_id and type = 'owner') then return new; end if;

  select decrypted_secret into k      from vault.decrypted_secrets where name = 'portfolio_resend_key';
  select decrypted_secret into sender from vault.decrypted_secrets where name = 'portfolio_email_from';
  if k is null or sender is null then return new; end if;

  -- What we know about this visit so far
  select
    max(data->>'org')     filter (where type = 'visit') as org,
    max(data->>'city')    filter (where type = 'visit') as city,
    max(data->>'country') filter (where type = 'visit') as country,
    max(data->>'ref')     filter (where type = 'visit') as ref,
    max(data->>'referrer') filter (where type = 'visit') as referrer,
    string_agg(distinct data->>'section', ', ') filter (where type = 'section') as seen,
    string_agg(distinct data->>'target', ', ')  filter (where type = 'click')   as clicked,
    bool_or(type = 'click' and data->>'target' = 'resume') as resume
  into v
  from portfolio.events where session_id = new.session_id;

  who := coalesce(nullif(new.data->>'name', ''), nullif(new.data->>'linkedin', ''), 'Someone');
  if nullif(new.data->>'company', '') is not null then who := who || ' (' || (new.data->>'company') || ')'; end if;
  subj := 'Portfolio lead: ' || who
          || case when coalesce(v.org, '') <> '' then ' via ' || v.org else '' end;

  body := 'Someone just reached out through emeraldd123.github.io.' || E'\n\n'
    || case when coalesce(new.data->>'linkedin', '') <> '' then 'LinkedIn:  ' || (new.data->>'linkedin') || E'\n' else '' end
    || case when coalesce(new.data->>'name', '')     <> '' then 'Name:      ' || (new.data->>'name')     || E'\n' else '' end
    || case when coalesce(new.data->>'company', '')  <> '' then 'Company:   ' || (new.data->>'company')  || E'\n' else '' end
    || case when coalesce(new.data->>'role', '')     <> '' then 'Role:      ' || (new.data->>'role')     || E'\n' else '' end
    || case when coalesce(new.data->>'email', '')    <> '' then 'Email:     ' || (new.data->>'email')    || E'\n' else '' end
    || case when coalesce(new.data->>'note', '')     <> '' then 'Note:      ' || (new.data->>'note')     || E'\n' else '' end
    || E'\nVisit\n'
    || 'Network:   ' || coalesce(nullif(v.org, ''), 'unknown') || E'\n'
    || 'Location:  ' || coalesce(nullif(concat_ws(', ', nullif(v.city, ''), nullif(v.country, '')), ''), 'unknown') || E'\n'
    || 'Came from: ' || coalesce('ref ' || nullif(v.ref, ''), nullif(v.referrer, ''), 'direct') || E'\n'
    || 'Looked at: ' || coalesce(v.seen, '-') || E'\n'
    || 'Clicked:   ' || coalesce(v.clicked, '-') || case when v.resume then ' (opened your resume)' else '' end || E'\n'
    || E'\nFull history: node backend/report.cjs';

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from', sender,
      'to', jsonb_build_array('benjamin.kadison@gmail.com'),
      'subject', left(subj, 180),
      'text', body
    )
  );
  return new;
exception when others then
  -- Never let an alert failure block the visitor's submission.
  return new;
end;
$$;
revoke all on function portfolio.notify_lead() from public, anon, authenticated;

drop trigger if exists notify_lead on portfolio.events;
create trigger notify_lead after insert on portfolio.events
  for each row when (new.type = 'intro') execute function portfolio.notify_lead();
