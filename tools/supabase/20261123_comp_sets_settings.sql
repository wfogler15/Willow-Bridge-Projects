-- Comp sets: per-set settings (baseline submarket for pipeline-vs-inventory and the RealPage section)
-- Additive: one new column, nothing existing changes. Safe to run more than once.
alter table market.comp_sets add column if not exists settings jsonb not null default '{}'::jsonb;
comment on column market.comp_sets.settings is 'Per-set options set in the Comp Sets tab, e.g. {"baseline":"<submarket name>"}';
