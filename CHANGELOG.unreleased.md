# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/23.02.1...HEAD)

### Added
- Remote datasets can now also be streamed from Google Cloud Storage URIs (`gs://`). [#6775](https://github.com/scalableminds/webknossos/pull/6775)
- Remote volume datasets in the neuroglancer precomputed format can now be viewed in WEBKNOSSOS. [#6716](https://github.com/scalableminds/webknossos/pull/6716)
- Added new mesh-related menu items to the context menu when a mesh is hovered in the 3d viewport. [#](https://github.com/scalableminds/webknossos/pull/6813)
- Highlight 'organization owner' in Admin>User page. [#6832](https://github.com/scalableminds/webknossos/pull/6832)
- Added functions to get and set segment colors to the frontend API (`api.data.{getSegmentColor,setSegmentColor}`). [#6853](https://github.com/scalableminds/webknossos/pull/6853)


### Changed
- Limit paid team sharing features to respective organization plans. [#6767](https://github.com/scalableminds/webknossos/pull/6776)
- Rewrite the database tools in `tools/postgres` to JavaScript and adding support for non-default Postgres username-password combinations. [#6803](https://github.com/scalableminds/webknossos/pull/6803)
- Added owner name to organization page. [#6811](https://github.com/scalableminds/webknossos/pull/6811)
- Remove multiline <TextArea> support from <InputComponent>. [#6839](https://github.com/scalableminds/webknossos/pull/6839)
- Improved the performance of the dataset table in the dashboard. [#6834](https://github.com/scalableminds/webknossos/pull/6834)
- Updated the styling and background of login, password reset/change and sign up pages. [#6844](https://github.com/scalableminds/webknossos/pull/6844)
- Replaced date handling and formatting library momentjs with dayjs. [#6849](https://github.com/scalableminds/webknossos/pull/6849)

### Fixed
- Fixed saving allowed teams in dataset settings. [#6817](https://github.com/scalableminds/webknossos/pull/6817)
- Fixed log streaming in Voxelytics workflow reports. [#6828](https://github.com/scalableminds/webknossos/pull/6828) [#6831](https://github.com/scalableminds/webknossos/pull/6831)
- Fixed some layouting issues with line breaks in segment list/dataset info tab. [#6799](https://github.com/scalableminds/webknossos/pull/6799)
- Fixed basic auth for exploring remote http datasets. [#6866](https://github.com/scalableminds/webknossos/pull/6866)
- Fixed the layouting in the connectome tab. [#6864](https://github.com/scalableminds/webknossos/pull/6864)
- Fixed that the quick-select and floodfill tool didn't update the segment list. [#6867](https://github.com/scalableminds/webknossos/pull/6867)
- Fixed deprecation warnings for antd' <Menu> component in Navbar. [#6860](https://github.com/scalableminds/webknossos/pull/6860)

### Removed
- Removed the old Datasets tab in favor of the Dataset Folders tab. [#6834](https://github.com/scalableminds/webknossos/pull/6834)

### Breaking Changes
