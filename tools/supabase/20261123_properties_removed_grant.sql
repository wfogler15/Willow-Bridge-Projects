-- Signed-in users could only read core.properties_removed, so "Remove from the dashboard" (and the upload's
-- remove-missing step) failed for everyone. Row-level security still limits inserts to admins and market editors.
grant insert on core.properties_removed to authenticated;
