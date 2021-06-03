# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- Make legacy bindings the default for users and task types with (adapt `true` to `false` if you want the opposite):
```
-- Activate legacy bindings for all users
UPDATE webknossos.users
SET userconfiguration = jsonb_set(
        userconfiguration,
        array['useLegacyBindings'],
        to_jsonb('true'::boolean))

-- Recommend legacy bindings for users when starting a new task
UPDATE webknossos.tasktypes
SET recommendedconfiguration = jsonb_set(
        recommendedconfiguration,
        array['useLegacyBindings'],
        to_jsonb('true'::boolean))
```

### Postgres Evolutions:
- [071-adapt-td-view-display-planes.sql](conf/evolutions/071-adapt-td-view-display-planes.sql)
