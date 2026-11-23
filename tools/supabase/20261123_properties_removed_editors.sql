-- Let market editors (not just admins) move a property to core.properties_removed
-- from the property card's "Remove from the dashboard…" action. Restoring stays admin-only.
create policy ma_insert_editors on core.properties_removed
  for insert with check (core.can_edit(market_id));
