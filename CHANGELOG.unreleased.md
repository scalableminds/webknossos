# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.05.1...HEAD)

### Added
- Added segment groups so that segments can be organized in a hierarchy (similar to skeletons). [#6966](https://github.com/scalableminds/webknossos/pull/6966)
- In addition to drag and drop, the selected tree(s) in the Skeleton tab can also be moved into another group by right-clicking the target group and selecting "Move selected tree(s) here". [#7005](https://github.com/scalableminds/webknossos/pull/7005)

### Changed

### Fixed
- Fixed unintended dependencies between segments of different volume layers which used the same segment id. Now, using the same segment id for segments in different volume layers should work without any problems. [#6960](https://github.com/scalableminds/webknossos/pull/6960)
- Fixed incorrect initial tab when clicking "Show Annotations" for a user in the user list. Also, the datasets tab was removed from that page as it was the same as the datasets table from the main dashboard. [#6957](https://github.com/scalableminds/webknossos/pull/6957)
- Fixed that unsaved changes were shown when opening an annotation, although there weren't any. [#6972](https://github.com/scalableminds/webknossos/pull/6972)
- Fixed misleading email about successful dataset upload, which was in some cases sent even for unusable datasets. [#6977](https://github.com/scalableminds/webknossos/pull/6977)
- Fixed upload of skeleton annotations with no trees, only bounding boxes, being incorrectly rejected. [#6985](https://github.com/scalableminds/webknossos/pull/6985)
- Fixed that Google Cloud Storage URLs with bucket names containing underscores could not be parsed. [#6998](https://github.com/scalableminds/webknossos/pull/6998)
- Fixed regression that caused public datasets to crash when not being logged in. [#7010](https://github.com/scalableminds/webknossos/pull/7010)

### Removed

### Breaking Changes
