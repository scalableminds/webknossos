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

### Postgres Evolutions:
- [105-verify-email.sql](conf/evolutions/105-verify-email.sql)
- [106-folder-no-slashes.sql](conf/evolutions/106-folder-no-slashes.sql)
