# Migration Guide (Unreleased)
All migrations (for unreleased versions) of WEBKNOSSOS are documented in this file.
See `MIGRATIONS.released.md` for the migrations which are part of official releases.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.02.3...HEAD)
- WKW datasets can now only be read if they have a `header.wkw` file in their mag directories. If specific datasets can no longer be loaded, consider adding such a file. Backend logging should show according error message. [#7528](https://github.com/scalableminds/webknossos/pull/7528)
- Content Security Policy (CSP) settings are now relaxed by default. To keep stricter CSP rules, add them to your specific `application.conf`. [#7589](https://github.com/scalableminds/webknossos/pull/7589)
- The way the segment index is stored for nd-annotations has been changed ([#7411](https://github.com/scalableminds/webknossos/pull/7411)). Annotations with old segment indices should be
archived if they do not contain relevant data. The following SQL query can be used:
```sql
UPDATE webknossos.annotations_ SET state = 'Finished' WHERE _id IN  (SELECT DISTINCT a._id AS nd_annotations_id FROM webknossos.annotations_ AS a INNER JOIN webknossos.datasets AS d ON a._dataset = d._id INNER JOIN webknossos.dataset_layer_additionalaxes AS dla ON d._id = dla._dataset)
```
- WEBKNOSSOS now uses Java 21 (up from Java 11). [#7599](https://github.com/scalableminds/webknossos/pull/7599)
- NodeJS version 18+ is required for snapshot tests with ShadowDOM elements from Antd v5. [#7522](https://github.com/scalableminds/webknossos/pull/7522)
- Email verification is disabled by default. To enable it, set `webKnossos.user.emailVerification.activated` to `true` in your `application.conf`. [#7620](https://github.com/scalableminds/webknossos/pull/7620) [#7621](https://github.com/scalableminds/webknossos/pull/7621)
- New dependency draco/libdraco-dev needs to be installed when deploying without docker and for local development.

### Postgres Evolutions:

- [113-analytics-events.sql](conf/evolutions/113-analytics-events.sql)
