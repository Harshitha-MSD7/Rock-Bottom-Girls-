# Database setup

Follow [MONITORING-SETUP.md](../MONITORING-SETUP.md) for the migration order,
backend configuration and test workflow. See [API-CONTRACT.md](../API-CONTRACT.md)
for the current shared interface.

`simple-schema.sql` is the original new-project baseline. It is not the final
current schema by itself. Do not rerun it on an existing project.

Current application tables: patients, caregiver_patients, devices, push_tokens.
There is no incidents table after migrations. notification_outbox contains only
temporary push delivery jobs and has no client access.

Existing databases already using home_lat/home_lng and status fields need only
20261012_notification_delivery.sql. The older coordinate migration clears old
positions; do not rerun it. Saving SQL in Git does not apply it to Supabase.
