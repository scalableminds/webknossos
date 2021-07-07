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
- The health check at api/health does not longer include checking data/health and tracings/health if the respective local modules are enabled. Consider monitoring those routes separately.

### Postgres Evolutions:
- [072-jobs-manually-repaired.sql](conf/evolutions/072-jobs-manually-repaired.sql)
