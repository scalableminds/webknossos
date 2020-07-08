# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.07.0...HEAD)

### Added

- Added the possibility to adjust the minimum and maximum value of the histogram for a layer. This option can be opened in the top right corner of the histogram. [#4630](https://github.com/scalableminds/webknossos/pull/4630)

- Added a warning to the segmentation tab when viewing `uint64` bit segmentation data. [#4598](https://github.com/scalableminds/webknossos/pull/4598)
- Added the possibility to have multiple user-defined bounding boxes in an annotation. Task bounding boxes are automatically converted to such user bounding boxes upon “copy to my account” / reupload as explorational annotation. [#4536](https://github.com/scalableminds/webknossos/pull/4536)
- Added additional information to each task in CSV download. [#4647](https://github.com/scalableminds/webknossos/pull/4647)
- Added the possibility to configure the sender address used in emails wk sends (mail.defaultSender in application.conf). [#4701](https://github.com/scalableminds/webknossos/pull/4701)
- Added a warning during task creation if task dataset cannot be accessed by project team members. [#4695](https://github.com/scalableminds/webknossos/pull/4695)
- Included the server time in error messages, making debugging misbehavior easier. [#4707](https://github.com/scalableminds/webknossos/pull/4707)

### Changed
- Separated the permissions of Team Managers (now actually team-scoped) and Dataset Managers (who can see all datasets). The database evolution makes all Team Managers also Dataset Managers, so no workflows should be interrupted. New users may have to be made Dataset Managers, though. For more information, refer to the updated documentation. [#4663](https://github.com/scalableminds/webknossos/pull/4663)
- Refined all webKnossos emails for user signups etc. Switched emails to use HTML templates for more bling bling. [#4676](https://github.com/scalableminds/webknossos/pull/4676)
- Backend NML parser no longer rejects NMLs with trees that have multiple connected components. Instead, it splits those into one separate tree per component. [#4688](https://github.com/scalableminds/webknossos/pull/4688)

### Fixed
- Fixed that merger mode didn't work with undo and redo. Also fixed that the mapping was not disabled when disabling merger mode. [#4669](https://github.com/scalableminds/webknossos/pull/4669)
- Fixed a bug where webKnossos relied upon but did not enforce organization names to be unique. [#4685](https://github.com/scalableminds/webknossos/pull/4685)
- Fixed that being outside of a bounding box could be rendered as if one was inside the bounding box in some cases. [#4690](https://github.com/scalableminds/webknossos/pull/4690)
- Fixed a bug where admins could revoke their own admin rights even if they are the only admin in their organization, leading to an invalid state. [#4698](https://github.com/scalableminds/webknossos/pull/4698)
- Fixed a bug where webKnossos ignored existing layer category information from datasource-properties.json when exploring layers on disk. [#4694](https://github.com/scalableminds/webknossos/pull/4694)

### Removed

- Removed the “are you sure” warning when editing datasets with no allowed teams. Instead, a warning during task creation is shown in this case. [#4695](https://github.com/scalableminds/webknossos/pull/4695)
