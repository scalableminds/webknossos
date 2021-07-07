# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- Consider setting `defaultToLegacyBindings` to `true` in application.conf if you want that new users use the classic controls by default.
- To make the classic mouse bindings the default for existing users and task types execute the following (adapt `true` to `false` if you want the opposite):
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
- [072-jobs-manually-repaired.sql](conf/evolutions/072-jobs-manually-repaired.sql)
- [073-modern-controls-user-conf.sql](conf/evolutions/073-modern-controls-user-conf.sql)
