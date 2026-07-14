-- ============================================================
-- STATUS: A production version of this schema IS APPLIED and LOADED
-- (July 2026) to Supabase project xazmwpozsmbrqoulizyn as acq_-prefixed
-- tables (acq_businesses [3,601 CSLB records], acq_outreach,
-- acq_score_snapshots, acq_score_weights, acq_config), with RLS:
-- anon = read-only, authenticated = write. The app reads it live.
-- The fuller normalized schema below (entities/people/properties/licenses)
-- is the roadmap for later enrichment phases.
-- ============================================================

-- =====================================================================
-- Acquisition Intelligence Platform — Supabase / PostgreSQL schema
-- Design follows the strategic plan: separate tables for locations,
-- entities, people, properties, licenses, and outreach (never one big
-- spreadsheet row); every sourced fact carries source + date; scores
-- are snapshotted at outreach time for quarterly calibration.
-- Paste into Supabase → SQL Editor → Run.
-- =====================================================================

-- ---------- enums ----------
create type tier as enum ('Acquire','Broker','Watch','Pass');
create type confidence as enum ('High','Medium','Low');
create type data_source as enum ('verified','reported','estimated','ai_extracted');
create type owner_response as enum ('none','replied','interested','declined');
create type property_relation as enum
  ('owner_occupied_confirmed','owner_occupied_likely','related_party_landlord','third_party_landlord','unknown');
create type outreach_channel as enum ('letter','call','email','linkedin','referral','event','inbound');
create type outreach_outcome as enum
  ('no_response','bad_contact','conversation','interested','not_interested','mandate_signed','loi_signed','closed');

-- ---------- 1. businesses (operating locations — one row per location) ----------
create table businesses (
  id            bigint generated always as identity primary key,
  -- identity
  name          text not null,
  dba_name      text,
  industry      text not null,              -- HVAC, Plumbing, ...
  naics_code    text,
  street        text,
  city          text,
  zip           text,
  county        text,
  phone         text,                       -- normalized E.164
  website       text,                       -- normalized domain
  google_place_id text unique,              -- Places terms: store the ID, refresh other fields
  data_axle_id  text unique,
  -- operating profile
  year_established int,
  years_in_business int generated always as (extract(year from now())::int - year_established) stored,
  revenue_est_usd  numeric,                 -- flag source below; never overwrite verified
  revenue_source   data_source default 'estimated',
  ebitda_est_usd   numeric,
  ebitda_source    data_source default 'estimated',
  employees_est    int,
  google_rating    numeric(2,1),
  google_review_count int,
  website_score    smallint check (website_score between 1 and 5),
  online_booking   boolean,
  recurring_revenue_pct smallint check (recurring_revenue_pct between 0 and 100),
  -- research-derived component inputs (0–100 unless noted)
  mgmt_depth       smallint,
  customer_diversification smallint,
  owner_dependence smallint,
  financial_record_quality smallint,
  backoffice_gap   smallint,
  marketing_gap    smallint,
  -- transition signals
  owner_tenure_years int,
  no_visible_succession boolean,
  limited_recent_expansion boolean,
  owner_response   owner_response default 'none',
  -- status
  disqualified     boolean default false,
  disqualified_reason text,
  tier             tier,                    -- last computed tier (cache; recompute in app)
  data_confidence  confidence default 'Low',
  notes            text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index on businesses (industry);
create index on businesses (county);
create index on businesses (tier);

-- ---------- 2. legal entities (CA SOS — kept separate per the plan) ----------
create table legal_entities (
  id             bigint generated always as identity primary key,
  entity_number  text unique,               -- CA SOS number
  legal_name     text not null,
  entity_type    text,                      -- corp, LLC, ...
  formation_date date,
  status         text,
  jurisdiction   text,
  principal_address text,
  mailing_address   text,
  agent_name     text,
  source_date    date
);

-- businesses ↔ entities (one biz can have several entities and vice versa)
create table business_entities (
  business_id  bigint references businesses(id) on delete cascade,
  entity_id    bigint references legal_entities(id) on delete cascade,
  match_confidence smallint,                -- 0–100 per the matching hierarchy
  match_method text,                        -- exact_name, address, officer, manual...
  primary key (business_id, entity_id)
);

-- ---------- 3. people (owners, officers, managers) ----------
create table people (
  id           bigint generated always as identity primary key,
  full_name    text not null,
  title        text,
  linkedin_url text,
  email        text,
  phone        text,
  years_in_role int,
  source       text,                        -- cslb_personnel, linkedin, conversation...
  source_date  date
);
create table business_people (
  business_id bigint references businesses(id) on delete cascade,
  person_id   bigint references people(id) on delete cascade,
  role        text,                         -- owner, officer, gm, controller...
  is_primary_owner boolean default false,
  primary key (business_id, person_id)
);

-- ---------- 4. properties (assessor / title data) ----------
create table properties (
  id           bigint generated always as identity primary key,
  business_id  bigint references businesses(id) on delete cascade,
  apn          text,                        -- assessor parcel number
  address      text,
  owner_name   text,
  owner_mailing_address text,               -- best direct-mail target
  acquisition_date date,
  relation     property_relation default 'unknown',
  evidence     text,
  source_date  date
);
create index on properties (business_id);

-- ---------- 5. licenses (CSLB, medical boards, etc.) ----------
create table licenses (
  id             bigint generated always as identity primary key,
  business_id    bigint references businesses(id) on delete cascade,
  license_number text,
  board          text,                      -- CSLB, Dental Board...
  classification text,                      -- C-10, C-20, C-36...
  status         text,
  issue_date     date,
  expiration_date date,
  disciplinary_action boolean default false,
  workers_comp   boolean,
  source_date    date,
  unique (board, license_number)
);
create index on licenses (business_id);

-- ---------- 6. outreach log (every touch; feeds calibration) ----------
create table outreach_activities (
  id           bigint generated always as identity primary key,
  business_id  bigint not null references businesses(id) on delete cascade,
  person_id    bigint references people(id),
  channel      outreach_channel not null,
  direction    text default 'outbound',
  summary      text,
  outcome      outreach_outcome,
  -- Tier-3 proprietary fields captured from conversations
  retirement_timeline text,
  price_expectation   numeric,
  seller_financing_open boolean,
  occurred_at  timestamptz default now(),
  next_action  text,
  next_action_date date,                    -- every Acquire record must have one
  created_by   text
);
create index on outreach_activities (business_id, occurred_at desc);
create index on outreach_activities (next_action_date) where next_action_date is not null;

-- ---------- 7. score snapshots (score-at-time-of-outreach → honest training data) ----------
create table score_snapshots (
  id            bigint generated always as identity primary key,
  business_id   bigint not null references businesses(id) on delete cascade,
  quality       smallint,
  transition    smallint,
  broker_fit    smallint,
  ai_upside     smallint,
  tier          tier,
  weights_version int,                      -- fk to score_weights.version
  taken_at      timestamptz default now()
);
create index on score_snapshots (business_id, taken_at desc);

-- ---------- 8. score weights (configuration, not code) ----------
create table score_weights (
  version     int not null,
  score_key   text not null,                -- quality | transition | broker | ai
  component   text not null,                -- revenue, recurring, mgmt, ...
  weight      smallint not null,
  active      boolean default true,
  changed_at  timestamptz default now(),
  change_note text,
  primary key (version, score_key, component)
);

-- seed: v1 weights (matches the app defaults)
insert into score_weights (version, score_key, component, weight) values
 (1,'quality','revenue',15),(1,'quality','recurring',15),(1,'quality','mgmt',15),
 (1,'quality','employees',10),(1,'quality','years',10),(1,'quality','custdiv',10),
 (1,'quality','reputation',10),(1,'quality','growth',5),(1,'quality','capex',5),(1,'quality','finance',5),
 (1,'transition','tenure',20),(1,'transition','response',20),(1,'transition','licAge',15),
 (1,'transition','noSucc',15),(1,'transition','mgmtRun',10),(1,'transition','propTen',10),(1,'transition','noExp',10),
 (1,'broker','transfer',25),(1,'broker','finqual',20),(1,'broker','demand',20),
 (1,'broker','size',15),(1,'broker','realestate',10),(1,'broker','clean',10),
 (1,'ai','webgap',25),(1,'ai','callgap',20),(1,'ai','backoffice',20),
 (1,'ai','marketing',15),(1,'ai','recurconv',10),(1,'ai','datagap',10);

-- ---------- 9. tier thresholds & buy-box (config) ----------
create table app_config (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
insert into app_config (key, value) values
 ('tier_thresholds', '{"min_quality":70,"min_transition":55,"min_broker_fit":55,"min_quality_floor":45}'),
 ('buy_box', '{"industries":["HVAC","Plumbing","Electrical","Fire protection","Restoration","Roofing"],"ebitda_min_usd":400000,"ebitda_max_usd":3000000,"counties":["Los Angeles","Orange","Ventura","Riverside","San Bernardino","San Diego"]}');

-- ---------- housekeeping ----------
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
create trigger businesses_touch before update on businesses
  for each row execute function touch_updated_at();

-- Row Level Security: enable and lock down (the app reads via anon key;
-- writes should go through authenticated users or service role).
alter table businesses enable row level security;
alter table legal_entities enable row level security;
alter table business_entities enable row level security;
alter table people enable row level security;
alter table business_people enable row level security;
alter table properties enable row level security;
alter table licenses enable row level security;
alter table outreach_activities enable row level security;
alter table score_snapshots enable row level security;
alter table score_weights enable row level security;
alter table app_config enable row level security;

-- read-only for anon (public site), full access for authenticated team
create policy anon_read_businesses on businesses for select to anon using (true);
create policy anon_read_weights on score_weights for select to anon using (true);
create policy anon_read_config on app_config for select to anon using (true);
create policy team_all_businesses on businesses for all to authenticated using (true) with check (true);
create policy team_all_outreach on outreach_activities for all to authenticated using (true) with check (true);
create policy team_all_people on people for all to authenticated using (true) with check (true);
-- (add equivalent authenticated policies for remaining tables as the team app grows)
