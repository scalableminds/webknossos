# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/20.04.0...HEAD)

### Added
- Users can undo finishing a task when the task was finished via the API, e.g. by a user script. [#4495](https://github.com/scalableminds/webknossos/pull/4495)
- Added the magnification used for determining the segment ids in the segmentation tab to the table of the tab. [#4480](https://github.com/scalableminds/webknossos/pull/4480)
- Added support for ID mapping of segmentation layer based on HDF5 agglomerate files. [#4469](https://github.com/scalableminds/webknossos/pull/4469)
- Added option to hide all unmapped segments to segmentation tab. [#4510](https://github.com/scalableminds/webknossos/pull/4510)
- When wK changes datasource-properties.json files of datasets, now it creates a backup log of previous versions. [#4534](https://github.com/scalableminds/webknossos/pull/4534)
- Added a warning to the position input in tracings if the current position is out of bounds. The warning colors the position input orange. [#4544](https://github.com/scalableminds/webknossos/pull/4544)
- Isosurface generation now also supports hdf5-style mappings. [#4531](https://github.com/scalableminds/webknossos/pull/4531)

### Changed
- Reported datasets can now overwrite existing ones that are reported as missing, this ignores the isScratch precedence. [#4465](https://github.com/scalableminds/webknossos/pull/4465)
- Improved the performance for large skeleton tracings with lots of comments. [#4473](https://github.com/scalableminds/webknossos/pull/4473)
- Users can now input floating point numbers into the rotation field in flight and oblique mode. These values will get rounded internally. [#4507](https://github.com/scalableminds/webknossos/pull/4507)
- Deleting an empty tree group in the `Trees` tab no longer prompts for user confirmation. [#4506](https://github.com/scalableminds/webknossos/pull/4506)
- Toggling the "Render missing data black" option now automatically reloads all layers making it unnecessary to reload the whole page. [#4516](https://github.com/scalableminds/webknossos/pull/4516)
- The "mappings" attribute of segmentation layers in datasource jsons can now be omitted. [#4532](https://github.com/scalableminds/webknossos/pull/4532)
- Uploading a single nml, allows to wrap the tracing in a new tree group. [#4563](https://github.com/scalableminds/webknossos/pull/4563)
- Unconnected trees no longer cause an error during NML import in the tracing view. Instead, unconnected trees are split into their components. The split components are wrapped in a tree group with the original tree's name. [#4541](https://github.com/scalableminds/webknossos/pull/4541)            
- Made the NML importer in the tracing view less strict. Incorrect timestamps, missing tree names or missing node radii no longer cause an error. [#4541](https://github.com/scalableminds/webknossos/pull/4541)

### Fixed
- Users only get tasks of datasets that they can access. [#4488](https://github.com/scalableminds/webknossos/pull/4488)
- Ignoring an error message caused by the drag and drop functionallity. This error claims that a reload of the tracing is required although everthing is fine. [#4544](https://github.com/scalableminds/webknossos/pull/4544)
- Fixed that after selecting a node in the 3d viewport the rotating center of the viewport was not updated immediately. [#4544](https://github.com/scalableminds/webknossos/pull/4544)
- Fixed the import of datasets which was temporarily broken. [#4497](https://github.com/scalableminds/webknossos/pull/4497)
- Fixed the displayed segment ids in segmentation tab when "Render Missing Data Black" is turned off. [#4480](https://github.com/scalableminds/webknossos/pull/4480)
- The datastore checks if a organization folder can be created before creating a new organization. [#4501](https://github.com/scalableminds/webknossos/pull/4501)
- Fixed a bug where under certain circumstances groups in the tree tab were not sorted by name. [#4542](https://github.com/scalableminds/webknossos/pull/4542)
- Fixed that `segmentationOpacity` could not be set anymore as part of the recommended settings for a task type. [#4545](https://github.com/scalableminds/webknossos/pull/4545)
- Fixed registration for setups with one organization and not configured defaultOrganization. [#4559](https://github.com/scalableminds/webknossos/pull/4559)
- Fixed a rendering error which could make some layers disappear in certain circumstances. [#4556](https://github.com/scalableminds/webknossos/pull/4556)

### Removed

-

