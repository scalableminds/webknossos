# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to WEBKNOSSOS are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/24.06.0...HEAD)

### Added
- Added the option for the owner to lock explorative annotations. Locked annotations cannot be modified by any user. An annotation can be locked in the annotations table and when viewing the annotation via the navbar dropdown menu. [#7801](https://github.com/scalableminds/webknossos/pull/7801)
- Uploading an annotation into a dataset that it was not created for now also works if the dataset is in a different organization. [#7816](https://github.com/scalableminds/webknossos/pull/7816)
- When downloading + reuploading an annotation that is based on a segmentation layer with active mapping, that mapping is now still be selected after the reupload. [#7822](https://github.com/scalableminds/webknossos/pull/7822)
- In the Voxelytics workflow list, the name of the WEBKNOSSOS user who started the job is displayed. [#7794](https://github.com/scalableminds/webknossos/pull/7795)
- Start an alignment job (aligns the section in a dataset) via the "AI Analysis" button. [#7820](https://github.com/scalableminds/webknossos/pull/7820)

### Changed
- The "WEBKNOSSOS Changelog" modal now lazily loads its content potentially speeding up the initial loading time of WEBKNOSSOS and thus improving the UX. [#7843](https://github.com/scalableminds/webknossos/pull/7843)
- Updated the min max settings for the histogram to allow floating point color layers to have negative min / max values. [#7873](https://github.com/scalableminds/webknossos/pull/7873)
- Made the login, registration, forgot password and dataset dashboard pages more mobile friendly. [#7876](https://github.com/scalableminds/webknossos/pull/7876)
- From now on only project owner get a notification email upon project overtime. The organization specific email list `overTimeMailingList` was removed. [#7842](https://github.com/scalableminds/webknossos/pull/7842)
- Replaced skeleton comment tab component with antd's `<Tree />`component. [#7802](https://github.com/scalableminds/webknossos/pull/7802)
- Replaced skeleton tab component with antd's `<Tree />`component. Added support for selecting tree ranges with SHIFT. [#7819](https://github.com/scalableminds/webknossos/pull/7819) 

### Fixed
- Fixed a bug where the warning to zoom in to see the agglomerate mapping was shown to the user even when the 3D viewport was maximized and no volume data was shown. [#7865](https://github.com/scalableminds/webknossos/issues/7865) 
- Fixed a bug where brushing on a fallback segmentation with active mapping and with segment index file would lead to failed saves. [#7833](https://github.com/scalableminds/webknossos/pull/7833)
- Fixed a bug where sometimes old mismatching javascript code would be served after upgrades. [#7854](https://github.com/scalableminds/webknossos/pull/7854)
- Fixed a bug where dataset uploads of zipped tiff data via the UI would be rejected. [#7856](https://github.com/scalableminds/webknossos/pull/7856)

### Removed

### Breaking Changes
