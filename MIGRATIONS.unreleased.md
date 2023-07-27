# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.08.0...HEAD)

- Postgres Evolution 105 (see below) adds email verification and sets the emails of all existing users as verified.
To set all email addresses as unverified, execute this query:
```sql
UPDATE webknossos.multiUsers SET isEmailVerified = false;
```

- When interacting with webknossos via the python library, make sure you update to the latest version, as the task and project api have changed. Compare [webknossos-libs#930](https://github.com/scalableminds/webknossos-libs/pull/930). [#7220](https://github.com/scalableminds/webknossos/pull/7220)

### Postgres Evolutions:
- [105-verify-email.sql](conf/evolutions/105-verify-email.sql)
- [106-task-terminology.sql](conf/evolutions/106-task-terminology.sql)
