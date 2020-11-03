# Migration Guide (Unreleased)
All migrations (for unreleased versions) of webKnossos are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
- As volume annotations in arbitrary magnifications are now supported and the behavior of magnification restrictions of tasks has changed (allow full zoom, but disable tools unless in correct magnification), you may want to restrict all volume and hybrid task types to 1-1 to achieve the old behavior (mag1-only):
```
update webknossos.tasktypes
set settings_allowedmagnifications = '{"min":1,"max":1,"shouldRestrict":true}'
where (tracingtype = 'volume' or tracingtype = 'hybrid')
and (settings_allowedmagnifications is null or settings_allowedmagnifications::json->>'shouldRestrict'='false');
```

### Postgres Evolutions:
- [057-add-layer-specific-view-configs.sql](conf/evolutions/056-add-layer-specific-view-configs.sql)
- [058-add-onlyAllowedOrganization.sql](conf/evolutions/057-add-onlyAllowedOrganization.sql) 
