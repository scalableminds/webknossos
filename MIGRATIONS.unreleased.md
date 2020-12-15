# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
-

### Postgres Evolutions:
- [060-multiusers.sql](conf/evolutions/060-multiusers.sql) (Note that its reversion can only be performed if there are no multiple users per multiuser yet)
