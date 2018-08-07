# Migration Guide
All migrations of webknossos are documented in this file.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
User-facing changes are documented in the [changelog](CHANGELOG.md).

## Unreleased
### Postgres Evolutions:
- [018-hybrid-annotations.sql](conf/evolutions/018-hybrid-annotations.sql)

## [18.08.0](https://github.com/scalableminds/webknossos/releases/tag/18.08.0) - 2018-07-23
### Postgres Evolutions:
- [013-add-logoUrl.sql](conf/evolutions/013-add-logoUrl.sql)
- [014-equalize-schema-and-evolutions.sql](conf/evolutions/014-equalize-schema-and-evolutions.sql)
- [015-add-organization-displayname.sql](conf/evolutions/015-add-organization-displayname.sql)
- To clean up half-deleted tasks as caused by [this bug](https://github.com/scalableminds/webknossos/issues/2873), run `update webknossos.annotations set isDeleted = true where _id in (select a._id from webknossos.annotations_ a join webknossos.tasks t on a._task = t._id where t.isDeleted and a.typ == 'Task')`
- [016-add-schema-version.sql](conf/evolutions/016-add-schema-version.sql)
- [017-add-organization-email.sql](conf/evolutions/017-add-organization-email.sql)
- Add email addresses for notifications about new users and about task overtime to the `webknossos.organizations` entries in the Postgres database (previously in `application.conf` > `braintracing.newuserlist` and `braintracing.overTimeList`)

## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05
First release
