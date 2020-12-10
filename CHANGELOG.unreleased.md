# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.12.0...HEAD)

### Added
- Datasets without any layer are now considered unimported. [#4959](https://github.com/scalableminds/webknossos/pull/4959)

### Changed
- The menu for viewing, editing and creating annotations for a dataset in the dashboard was cleaned up a bit. Creating a hybrid (skeleton + volume) annotation is now the default way of annotating a dataset. The other options are still available via a dropdown. [#4939](https://github.com/scalableminds/webknossos/pull/4939)
- For 2d-only datasets the view mode toggle is hidden. [#4952](https://github.com/scalableminds/webknossos/pull/4952)
- Persist the selected overwrite behavior for hybrid and volume annotations. [#4962](https://github.com/scalableminds/webknossos/pull/4962)
- Backend NML parser now allows NML nodes without radius attribute. Instead, their radius now defaults to a value of 1.0, which is also the new default value for initial nodes. Note that the node radius is only relevant when default setting “overwrite node radius” is disabled. [#4982](https://github.com/scalableminds/webknossos/pull/4982)

### Fixed
- Fix crash for trees with high comment count (> 100000 nodes). [#4965](https://github.com/scalableminds/webknossos/pull/4965)

### Removed
-
