# Changelog (Released)

All notable user-facing changes to webknossos are documented in this file.
See `CHANGELOG.unreleased.md` for the changes which are not yet part of an official release.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## [20.04.0](https://github.com/scalableminds/webknossos/releases/tag/20.04.0) - 2020-03-23
[Commits](https://github.com/scalableminds/webknossos/compare/20.03.0...20.04.0)

### Highlights
- Added the possibility to reopen finished tasks as non-admin for a configurable time. [#4415](https://github.com/scalableminds/webknossos/pull/4415)
- Added support for drag-and-drop import of NML files even if the current view is read-only (e.g., because a dataset was opened in "view" mode). In this case, a new tracing is directly created into which the NML file is imported. [#4459](https://github.com/scalableminds/webknossos/pull/4459)
- Added support for setting view configuration defaults in the `datasource-properties.json`. Use the `defaultViewConfiguration` field for Dataset settings and the `defaultViewConfiguration` field inside a layer for layer-specific settings. [#4357](https://github.com/scalableminds/webknossos/pull/4357)


### Added
- Added support for setting view configuration defaults in the `datasource-properties.json`. Use the `defaultViewConfiguration` field for Dataset settings and the `defaultViewConfiguration` field inside a layer for layer-specific settings. [#4357](https://github.com/scalableminds/webknossos/pull/4357)
- Added a notification when downloading nml including volume that informs that the fallback data is excluded in the download. [#4413](https://github.com/scalableminds/webknossos/pull/4413)
- Added the possibility to reopen finished tasks as non-admin for a configurable time. [#4415](https://github.com/scalableminds/webknossos/pull/4415)
- Added support for drag-and-drop import of NML files even if the current view is read-only (e.g., because a dataset was opened in "view" mode). In this case, a new tracing is directly created into which the NML file is imported. [#4459](https://github.com/scalableminds/webknossos/pull/4459)
- Added download of task configurations as CSV after task creation and in the task list view. [#4491](https://github.com/scalableminds/webknossos/pull/4491)
- Added indication for reloading a dataset in the dataset actions in the dashboard. [#4421](https://github.com/scalableminds/webknossos/pull/4421)
- Added support for creating a tree group when importing a single NML into an existing annotation. [#4489](https://github.com/scalableminds/webknossos/pull/4489)
- Added login prompt to the tracing page when fetching the dataset fails. Upon successful login, the dataset gets fetched with the rights of the newly logged-in user. [#4467](https://github.com/scalableminds/webknossos/pull/4467)

### Changed
- Changed NML import in tracings to try parsing files as NMLs and protobuf regardless of the file extension. [#4421](https://github.com/scalableminds/webknossos/pull/4421)
- Using the "Best Quality First" strategy in combination with having the "Render Black Data" setting disabled works better now. [#4470](https://github.com/scalableminds/webknossos/pull/4470)
- Default interval for detecting new/deleted datasets on disk has been reduced from 10 to 1 minute. [#4464](https://github.com/scalableminds/webknossos/pull/4464)
- The config values datastore.publicUri, tracingstore.publicUri and http.uri are now reapplied from the config at every startup if your instance has localhost-stores [#4482](https://github.com/scalableminds/webknossos/pull/4482)

### Fixed
- Fixed that a node was created when using right click while brushing mode is active in hybrid tracings. [#4433](https://github.com/scalableminds/webknossos/pull/4433)
- Fixed opening view only dataset links with arbitrary modes being initially displayed in plane mode. [#4421](https://github.com/scalableminds/webknossos/pull/4421)
- Fixed that converting a volume tracing into a hybrid tracing opens the hybrid tracing in "volume" mode. [#4467](https://github.com/scalableminds/webknossos/pull/4467)
- Fixed a bug where users were wrongly allowed to edit the description of an annotation they were allowed to see but not update [#4466](https://github.com/scalableminds/webknossos/pull/4466)
- Fixed the creation of histograms for float datasets that only have one value besides 0. [#4468](https://github.com/scalableminds/webknossos/pull/4468)
- Fixed the creation of histograms for float datasets that have values close to the minimum. [#4475](https://github.com/scalableminds/webknossos/pull/4475)
- Fixed the import of datasets which was temporarily broken. [#4497](https://github.com/scalableminds/webknossos/pull/4497)

### Removed
-

## [20.03.0](https://github.com/scalableminds/webknossos/releases/tag/20.03.0) - 2020-02-27
[Commits](https://github.com/scalableminds/webknossos/compare/20.02.0...20.03.0)

### Highlights
- Added support for datasets with more layers than the hardware can render simultaneously. The user can disable layers temporarily to control for which layers the GPU resources should be used. [#4424](https://github.com/scalableminds/webknossos/pull/4424)
- Time tracking precision is improved. [#4445](https://github.com/scalableminds/webknossos/pull/4445)

### Added
- Added support for datasets with more layers than the hardware can render simultaneously. The user can disable layers temporarily to control for which layers the GPU resources should be used. [#4424](https://github.com/scalableminds/webknossos/pull/4424)
- Added a notification when downloading nml including volume that informs that the fallback data is excluded in the download. [#4413](https://github.com/scalableminds/webknossos/pull/4413)
- Added a simpler method to install webKnossos on an own server. [#4446](https://github.com/scalableminds/webknossos/pull/4446)

### Changed
- Made the navbar scrollable on small screens. [#4413](https://github.com/scalableminds/webknossos/pull/4413)
- Opening the settings sidebar when viewing a dataset or tracing defaults to the dataset settings now. [#4425](https://github.com/scalableminds/webknossos/pull/4425)
- Better onboarding experience for new users on webknossos.org. [#4439](https://github.com/scalableminds/webknossos/pull/4439)

### Fixed
- Fixed that for uint16 data layer the default value range of [0, 255] was used, causing most of the data to look white without manual adjustments. Now the correct range of [0, 65535] is used as default. [#4381](https://github.com/scalableminds/webknossos/pull/4381)
- Time tracking precision is improved. [#4445](https://github.com/scalableminds/webknossos/pull/4445)

### Removed
-


## [20.02.0](https://github.com/scalableminds/webknossos/releases/tag/20.02.0) - 2020-01-27
[Commits](https://github.com/scalableminds/webknossos/compare/20.01.0...20.02.0)

### Added
- Added new viewing permission for annotations: public (everyone with the link has access, logged in or not), internal (everyone from your organization has access), private (only you and your team managers and admins have access). The new default is internal as it is the old default non-public.
- Added support for using task ids as base for a new task, if the corresponding task only has one (finished) instance. [#4404](https://github.com/scalableminds/webknossos/pull/4404)

### Changed
- Changed the error message when importing a dataset without resolution directories. [#4389](https://github.com/scalableminds/webknossos/pull/4389)

### Fixed
- Fixed the deactivation of datasets if no datasets are present. [#4388](https://github.com/scalableminds/webknossos/pull/4388)
- Fixed the team sharing settings for private annotations. [#4409](https://github.com/scalableminds/webknossos/pull/4409)
- Fixed the team sharing loading for read only tracings. [#4411](https://github.com/scalableminds/webknossos/pull/4411)
- Fixed the renaming of annotations in the tracing view. [#4416](https://github.com/scalableminds/webknossos/pull/4416)


## [20.01.0](https://github.com/scalableminds/webknossos/releases/tag/20.01.0) - 2020-01-08
[Commits](https://github.com/scalableminds/webknossos/compare/19.12.0...20.01.0)

### Highlights
- Added a scale to the y-axis of histograms to indicate the logarithmic representation. Additionally, small histogram values are smoothed out. [#4349](https://github.com/scalableminds/webknossos/pull/4349)
- You can now share your annotations with selected teams. These annotations appear in the Shared Annotations Tab in the dashboard. [#4304](https://github.com/scalableminds/webknossos/pull/4304)

### Added
- Added `publicUri` configs for datastore and tracingstore for initial setup. [#4368](https://github.com/scalableminds/webknossos/pull/4368)
- Added a button to delete all cached data buckets of color layer and the reload them. [#4383](https://github.com/scalableminds/webknossos/pull/4383)
- Added a scale to the y-axis of histograms to indicate the logarithmic representation. Additionally, small histogram values are smoothed out. [#4349](https://github.com/scalableminds/webknossos/pull/4349)
- Added a new way of sharing annotations. You can share your annotations with selected teams. These annotations appear in the Shared Annotations Tab in the dashboard. [#4304](https://github.com/scalableminds/webknossos/pull/4304)
- Added an option to invert the color values of color layers. [#4382](https://github.com/scalableminds/webknossos/pull/4382)

### Changed
- Changed the way the new active tree is selected after deleting a tree. Now the tree with the next highest id, compared to the id of the deleted tree, is selected. [#4370](https://github.com/scalableminds/webknossos/pull/4370)
- Consolidates URI handling in the config. Pairs of `uri` and `secured` entries are now specified as just `uri` and require either `http://` or `https://` prefix. [#4368](https://github.com/scalableminds/webknossos/pull/4368)
- Renamed initial organization for the dev deployment to `sample_organization`. [#4368](https://github.com/scalableminds/webknossos/pull/4368)

### Fixed
- Fixed an issue where webKnossos would complain in certain scenarios when resolutions of datasets were not complete. [#4344](https://github.com/scalableminds/webknossos/pull/4344)
- Fixed permissions to all task lists, so only administrable tasks can get accessed. [#4331](https://github.com/scalableminds/webknossos/pull/4331)


## [19.12.0](https://github.com/scalableminds/webknossos/releases/tag/19.12.0) - 2019-11-25
[Commits](https://github.com/scalableminds/webknossos/compare/19.11.0...19.12.0)

### Highlights
- Added possibility to disable saving in an explorative annotation. This feature can save a lot of resources when dealing with very large NMLs which don't need to be persisted. [#4321](https://github.com/scalableminds/webknossos/pull/4321)
- Added support for importing tracings in a binary protobuf format via drag and drop. [#4320](https://github.com/scalableminds/webknossos/pull/4320)
- Fixed broken sorting in the dataset table of the dashboard. [#4318](https://github.com/scalableminds/webknossos/pull/4318)

### Added
- Added support for importing tracings in a binary protobuf format via drag and drop. [#4320](https://github.com/scalableminds/webknossos/pull/4320)
- Added an API to set a tree active by name. [#4317](https://github.com/scalableminds/webknossos/pull/4317)
- Added possibility to disable saving in an explorative annotation. This feature can save a lot of resources when dealing with very large NMLs which don't need to be persisted. [#4321](https://github.com/scalableminds/webknossos/pull/4321)

### Changed
- Some user actions, like deleting a group with all subtrees, resulted in lots of entries in the undo stack (one for each deleted tree). Those actions are now handled as a single atomic change and can be undone with a single undo invocation. [#4312](https://github.com/scalableminds/webknossos/pull/4312)
- The "Find Data" feature will jump to the center of the layer's bounding box, if no data could be found. The "Find Data" feature can be found next to each layer's name in the dataset settings tab. [#4346](https://github.com/scalableminds/webknossos/pull/4346)

### Fixed
- Fixed broken sorting in the dataset table of the dashboard. [#4318](https://github.com/scalableminds/webknossos/pull/4318)
- Fixed annotation access to match the text in the modal. [#4314](https://github.com/scalableminds/webknossos/pull/4314)
- Fixed that the brush tool could be selected in an read-only tracing. [#4345](https://github.com/scalableminds/webknossos/pull/4345)
- Fixed the name of downloaded annotation zips. [#4330](https://github.com/scalableminds/webknossos/pull/4330)

## [19.11.0](https://github.com/scalableminds/webknossos/releases/tag/19.11.0) - 2019-10-28
[Commits](https://github.com/scalableminds/webknossos/compare/19.10.0...19.11.0)

### Added
- Added an API to manage DataStores and TracingStores as admin. [#4286](https://github.com/scalableminds/webknossos/pull/4286)

### Fixed
- Cleaned up error reporting wording in case of dataset access failures (e.g. due to not being logged in). [#4301](https://github.com/scalableminds/webknossos/pull/4301)
- Fixed handling of uint64 data layers in sql evolution. [#4303](https://github.com/scalableminds/webknossos/pull/4303)


## [19.10.0](https://github.com/scalableminds/webknossos/releases/tag/19.10.0) - 2019-09-30
[Commits](https://github.com/scalableminds/webknossos/compare/19.09.0...19.10.0)

### Highlights
- Clicking on an experience domain of a user, while multiple users are selected will edit the domain of all selected users (instead of only the domain of the clicked row). [#4280](https://github.com/scalableminds/webknossos/pull/4280)
- Creating a new skeleton tree group will always activate that group. [#4282](https://github.com/scalableminds/webknossos/pull/4282)
- Resetting a task to the initials state is now also allowed for volume tasks. [#4276](https://github.com/scalableminds/webknossos/pull/4276)

### Added
- Reset to base is now also allowed for volume tasks. [#4276](https://github.com/scalableminds/webknossos/pull/4276)

### Changed

- Renamed "Expected Time" to "Time Limit" in the project table. [#4278](https://github.com/scalableminds/webknossos/pull/4278)
- Clicking on an experience domain of a user, while multiple users are selected will edit the domain of all selected users (instead of only the domain of the clicked row). [#4280](https://github.com/scalableminds/webknossos/pull/4280)
- Creating a new skeleton tree group will always activate that group. [#4282](https://github.com/scalableminds/webknossos/pull/4282)

### Fixed
- When creating tasks from zip, the individual nml names are used again, rather than the zip name. [#4277](https://github.com/scalableminds/webknossos/pull/4277)

### Removed
- Removed the Search shortcut (Ctrl+Shift+F) for comments in the tracing view, since that shortcut collides with the tree search. [#4291](https://github.com/scalableminds/webknossos/pull/4291)

## [19.09.0](https://github.com/scalableminds/webknossos/releases/tag/19.09.0) - 2019-08-28
[Commits](https://github.com/scalableminds/webknossos/compare/19.08.0...19.09.0)

### Highlights
- Users can see their own time statistics now. [#4220](https://github.com/scalableminds/webknossos/pull/4220)
- Added limited support for `uint64` segmentation layer by using the lower 4 bytes. [#4233](https://github.com/scalableminds/webknossos/pull/4233)
- Added a scale bar to the 3D viewport. [#4258](https://github.com/scalableminds/webknossos/pull/4258)
- Added currently spent hours on a project to the project progress view. [#4236](https://github.com/scalableminds/webknossos/pull/4236)


### Added
- Added the possibility to have an existing annotation as a base for a new task, thus making it also possible to have a base tracing for volume tasks. [#4198](https://github.com/scalableminds/webknossos/pull/4198)
- Indicating active nml downloads with a loading icon. [#4228](https://github.com/scalableminds/webknossos/pull/4228)
- Added possibility for users to see their own time statistics. [#4220](https://github.com/scalableminds/webknossos/pull/4220)
- Added merger mode as a setting for task types. Enabling this setting will automatically activate merger mode in tasks. [#4269](https://github.com/scalableminds/webknossos/pull/4269)
- The segmentation layer can now be turned invisible and also supports the find data feature. [#4232](https://github.com/scalableminds/webknossos/pull/4232)
- Enabled the advanced search for the comment tab. [#4238](https://github.com/scalableminds/webknossos/pull/4238)
- Added limited support for `uint64` segmentation layer by using the lower 4 bytes. [#4233](https://github.com/scalableminds/webknossos/pull/4233)
- Added an API route to add and delete dataStores. [#4242](https://github.com/scalableminds/webknossos/pull/4242)
- Added a scale bar to the 3D viewport. [#4258](https://github.com/scalableminds/webknossos/pull/4258)
- Added the possibility to import an nml file as a string and to reset the active skeleton tracing to the API. [#4252](https://github.com/scalableminds/webknossos/pull/4252)
- Added currently spent hours on a project to the project progress view. [#4236](https://github.com/scalableminds/webknossos/pull/4236)

### Changed
- Each of the  columns of the dataset table and explorative annotations table in the dashboard now have an individual fixed width, so the tables become scrollable on smaller screens. [#4207](https://github.com/scalableminds/webknossos/pull/4207)
- When uploading a zipped annotation (such as volume / hybrid / collection), the zip name is used for the resulting explorative annotation, rather than the name of the contained NML file. [#4222](https://github.com/scalableminds/webknossos/pull/4222)
- Color and segmentation layer are not longer treated separately in the dataset settings in tracing/view mode.  [#4232](https://github.com/scalableminds/webknossos/pull/4232)

### Fixed
- Data for disabled or invisible layers will no longer be downloaded, saving bandwidth and speeding up webKnossos in general. [#4202](https://github.com/scalableminds/webknossos/pull/4202)
- Fixed tooltip not disappearing in the statistics view in certain circumstances. [#4219](https://github.com/scalableminds/webknossos/pull/4219)
- Fixed the error messages when trying to access a dataset with insufficient permissions. [#4244](https://github.com/scalableminds/webknossos/pull/4244)
- Fixed the upload of volume tracings by recognizing the correct format of the fallback layer. [#4248](https://github.com/scalableminds/webknossos/pull/4248)
- Fixed an imprecision when exporting an NML via the front-end. [#4262](https://github.com/scalableminds/webknossos/pull/4262)
- Fixed viewing and tracing of datasets which only contain a segmentation layer. [#4265](https://github.com/scalableminds/webknossos/pull/4265)


## [19.08.0](https://github.com/scalableminds/webknossos/releases/tag/19.08.0) - 2019-07-29
[Commits](https://github.com/scalableminds/webknossos/compare/19.07.0...19.08.0)

### Highlights
- Added the possibility to remove isosurfaces from the 3D viewport by CTRL+Clicking it. [#4185](https://github.com/scalableminds/webknossos/pull/4185)
- Added support for int16 and uint16 color layers. [#4152](https://github.com/scalableminds/webknossos/pull/4152)
- Team managers and admins can now get tasks that they had previously cancelled. [#4088](https://github.com/scalableminds/webknossos/pull/4088)
- Increased performance for time logging. [#4196](https://github.com/scalableminds/webknossos/pull/4196)

### Added
- Volume tasks with only one finished instance can now be viewed as CompoundTask. [#4167](https://github.com/scalableminds/webknossos/pull/4167)
- Added the possibility to remove isosurfaces from the 3D viewport by CTRL+Clicking it. [#4185](https://github.com/scalableminds/webknossos/pull/4185)
- Added support for `int16` and `uint16` color layers. [#4152](https://github.com/scalableminds/webknossos/pull/4152)
- Added histogram support for `int16` and `uint16` color layers. Additionally refined support for `float` color layers. [#4195](https://github.com/scalableminds/webknossos/pull/4195)

### Changed
- Volume project download zips are reorganized to contain a zipfile for each annotation (that in turn contains a data.zip and an nml file). [#4167](https://github.com/scalableminds/webknossos/pull/4167)
- Team managers and admins can now get tasks that they had previously cancelled. [#4088](https://github.com/scalableminds/webknossos/pull/4088)
- Recording is now automatically turned off when switching from flight/oblique to orthogonal mode to prevent accidental node creation when switching back later. [#4211](https://github.com/scalableminds/webknossos/pull/4211)

### Fixed
- Fixed a bug where volume tracings could not be converted to hybrid. [#4159](https://github.com/scalableminds/webknossos/pull/4159)
- Fixed a bug where for uint24 color layers, scrambled data was shown for missing magnifications. [#4188](https://github.com/scalableminds/webknossos/pull/4188)
- Fixed a bug where collapsing/expanding all tree groups would trigger when toggling a single tree [#4178](https://github.com/scalableminds/webknossos/pull/4178)
- Fixed performance for time logging. [#4196](https://github.com/scalableminds/webknossos/pull/4196)
- Personal tracing layouts are saved per user now. [#4217](https://github.com/scalableminds/webknossos/pull/4217)
- Fixed an error message when quickly resizing the browser window. [#4205](https://github.com/scalableminds/webknossos/pull/4205)

### Removed
-


## [19.07.0](https://github.com/scalableminds/webknossos/releases/tag/19.07.0) - 2019-07-01
[Commits](https://github.com/scalableminds/webknossos/compare/19.06.0...19.07.0)

### Highlights
- Added a histogram and min- / max-sliders to the dataset settings for each layer. This replaces the brightness and contrast settings. [#4105](https://github.com/scalableminds/webknossos/pull/4105)
- Added the possibility to enforce a certain magnification range for tasks (can be configured in the corresponding task type). [#4101](https://github.com/scalableminds/webknossos/pull/4101)
- Added the possibility for admins to add experience domains while creating new tasks. [#4119](https://github.com/scalableminds/webknossos/pull/4119)

### Added
- Added the possibility to enforce a certain magnification range for tasks (can be configured in the corresponding task type). [#4101](https://github.com/scalableminds/webknossos/pull/4101)
- Added the possibility for admins to add experience domains while creating new tasks. [#4119](https://github.com/scalableminds/webknossos/pull/4119)
- Added a histogram to the dataset settings for each layer. It simplifies adjusting the brightness and contrast of a layer and replaces the brightness and contrast slider. [#4105](https://github.com/scalableminds/webknossos/pull/4105)
- The dataset and the explorative annotations table in the dashboard are now horizontally scrollable if the window is not wide enough. Additionally, clicking on the name of a dataset in the dataset table opens the dataset in view mode. [#4136](https://github.com/scalableminds/webknossos/pull/4136)
- Added an two additional buttons to the dropdown menu of the tree hierarchy view. On Click, one collapses the other expands all subgroups. [#4143](https://github.com/scalableminds/webknossos/pull/4143)
### Changed
- The tooltip of the timeline chart in the Time Tracking view now displays the duration in minutes:seconds. [#4121](https://github.com/scalableminds/webknossos/pull/4121)
- Reactivated and renamed the "Quality" setting to "Hardware Utilization". Using a higher value will render data in higher quality, but puts more stress on the user's hardware and bandwidth. [#4142](https://github.com/scalableminds/webknossos/pull/4142)


### Fixed
- Fixed that team managers couldn't view time tracking details of other users anymore. [#4125](https://github.com/scalableminds/webknossos/pull/4125)
- Fixed the positioning of the tooltip of the timeline chart in the Time Tracking view. [#4121](https://github.com/scalableminds/webknossos/pull/4121)
- Fixed a rendering problem which caused a red viewport on some Windows machines. [#4133](https://github.com/scalableminds/webknossos/pull/4133)

### Removed
- The brightness and contrast slider in the dataset got removed in favour of the new histogram feature. [#4105](https://github.com/scalableminds/webknossos/pull/4105)


## [19.06.0](https://github.com/scalableminds/webknossos/releases/tag/19.06.0) - 2019-05-27
[Commits](https://github.com/scalableminds/webknossos/compare/19.05.0...19.06.0)

### Highlights
- The time tracking view now displays dates instead of hours when having more than one day selected. [#4028](https://github.com/scalableminds/webknossos/pull/4028)
- BossDB datasets can now be added to webKnossos using the webknossos-connect service. [#4036](https://github.com/scalableminds/webknossos/pull/4036)
- When holding CTRL while toggling the visibility of a layer, that layer will be made exclusively visible. [#4061](https://github.com/scalableminds/webknossos/pull/4061)

### Added
- Non-admin users now can see their own tracing time statistics. [#4028](https://github.com/scalableminds/webknossos/pull/4028)
- The extent of a dataset is now displayed next to the scale in the dataset list in the dashboard. [#4058](https://github.com/scalableminds/webknossos/pull/4058)
- BossDB datasets can now be added to webKnossos using the webknossos-connect service. [#4036](https://github.com/scalableminds/webknossos/pull/4036)
- Added an auto-brush feature for selected datasets. [#4053](https://github.com/scalableminds/webknossos/pull/4053)
- When holding CTRL while toggling the visibility of a layer, that layer will be made exclusively visible. This change makes it easier to quickly compare different data layers against each other. [#4061](https://github.com/scalableminds/webknossos/pull/4061)

### Changed
- Heavily improved mapping creation/activation performance. [#4103](https://github.com/scalableminds/webknossos/pull/4103)
- The NML parser now rounds floating point values in node coordinates. [#4045](https://github.com/scalableminds/webknossos/pull/4045)
- The time tracking view now displays dates instead of hours when having more then one day selected. The display id's in the timeline diagram are not the task ids. The tooltip of the timeline diagram also got a rework. [#4028](https://github.com/scalableminds/webknossos/pull/4028)
- Improved the editing of datasets. Changes suggested by webKnossos will be easier to recognize as suggestions. [4104](https://github.com/scalableminds/webknossos/pull/4104)
- The time tracking view now displays dates instead of hours when having more than one day selected. The display id's in the timeline diagram are not the task ids. The tooltip of the timeline diagram also got a rework. [#4028](https://github.com/scalableminds/webknossos/pull/4028)

### Fixed
- Fixed an issue where the 3D view was not rendered correctly after maximizing another pane. [#4098](https://github.com/scalableminds/webknossos/pull/4098)
- The admin task list now only shows tasks belonging to a project one can administrate. [#4087](https://github.com/scalableminds/webknossos/pull/4087)
- When making a hybrid tracing from a volume tracing, the user bounding box is no longer lost. [#4062](https://github.com/scalableminds/webknossos/pull/4062)

### Removed
- It is no longer possible to scroll through planes while dragging one. [#4085](https://github.com/scalableminds/webknossos/pull/4085)


## [19.05.0](https://github.com/scalableminds/webknossos/releases/tag/19.05.0) - 2019-04-29
[Commits](https://github.com/scalableminds/webknossos/compare/19.04.0...19.05.0)

### Changed
- Improved performance for large tracings. [#3995](https://github.com/scalableminds/webknossos/pull/3995)
- Improved how the rendering quality can be adapted in the settings. The setting can now be used to tune the quality to your hardware specification. [#4015](https://github.com/scalableminds/webknossos/pull/4015)
- Empty trees in skeleton tracings are now allowed. [#4010](https://github.com/scalableminds/webknossos/pull/4010)
- Creating a hybrid tracing now asks whether to use the existing segmentation layer or use a new one. [#4033](https://github.com/scalableminds/webknossos/pull/4033)

### Fixed
- Fixed a missing redirect after registering for an existing organization (with autoVerify=true) via the onboarding flow. [#3984](https://github.com/scalableminds/webknossos/pull/3984)
- Fixed rendering artifacts which could occur under certain conditions. [#4015](https://github.com/scalableminds/webknossos/pull/4015)
- Fixed that the zoom step was reset after switching to a new task. [#4049](https://github.com/scalableminds/webknossos/pull/4049)


## [19.04.0](https://github.com/scalableminds/webknossos/releases/tag/19.04.0) - 2019-04-01
[Commits](https://github.com/scalableminds/webknossos/compare/19.03.0...19.04.0)

### Highlights
This release multiple new interactions are expanding webKnossos:
- Added merger mode for skeleton and hybrid tracings. It allows to merge segments from e.g. generated oversegmentations. [#3619](https://github.com/scalableminds/webknossos/pull/3619)
- Added a shortcut (Q) and button to screenshot the tracing views. [#3834](https://github.com/scalableminds/webknossos/pull/3834)
- Rendered isosurfaces in the 3D viewport can now be interacted with. Shift+Click on an isosurface will jump exactly to where you clicked. Also, hovering over an isosurface will highlight that cell in all viewports. [#3858](https://github.com/scalableminds/webknossos/pull/3858)
- Neuroglancer precomputed datasets can now be added to webKnossos using the webknossos-connect service. [#3843](https://github.com/scalableminds/webknossos/pull/3843)

Also the data viewing and tracing workflow is smoothed further:
- Different loading strategies are now supported ("best quality first" and "progressive quality"). Additionally, the rendering can use different magnifications as a fallback. [#3801](https://github.com/scalableminds/webknossos/pull/3801)
- Performance improvements :racing_car: [#3880](https://github.com/scalableminds/webknossos/pull/3880) & [#3902](https://github.com/scalableminds/webknossos/pull/3902)

### Added
- Rendered isosurfaces in the 3D viewport can now be interacted with. Shift+Click on an isosurface will jump exactly to where you clicked. Also, hovering over an isosurface will highlight that cell in all viewports. [#3858](https://github.com/scalableminds/webknossos/pull/3858)
- webKnossos now comes with a list of sample datasets that can be automatically downloaded and imported from the menu. [#3725](https://github.com/scalableminds/webknossos/pull/3725)
- Added a shortcut (Q) and button in the actions dropdown to screenshot the tracing views. The screenshots will contain everything that is visible in the tracing views, so feel free to disable the crosshairs in the settings or toggle the tree visibility using the (1) and (2) shortcuts before triggering the screenshot. [#3834](https://github.com/scalableminds/webknossos/pull/3834)
- Neuroglancer precomputed datasets can now be added to webKnossos using the webknossos-connect (wk-connect) service. To setup a wk-connect datastore follow the instructions in the [Readme](https://github.com/scalableminds/webknossos-connect). Afterwards, datasets can be added through "Add Dataset" - "Add Dataset via wk-connect". [#3843](https://github.com/scalableminds/webknossos/pull/3843)
- Added support for mappings for 8-bit and 16-bit segmentation layers. [#3953](https://github.com/scalableminds/webknossos/pull/3953)
- The dataset settings within the tracing view allow to select between different loading strategies now ("best quality first" and "progressive quality"). Additionally, the rendering can use different magnifications as a fallback (instead of only one magnification). [#3801](https://github.com/scalableminds/webknossos/pull/3801)
- The mapping selection dropdown is now sorted alphabetically. [#3864](https://github.com/scalableminds/webknossos/pull/3864)
- Added the possibility to filter datasets in the dashboard according to their availability. By default, datasets which are missing on disk (e.g., when the datastore was deleted) are not shown anymore. This behavior can be configured via the settings icon next to the search box in the dashboard. [#3883](https://github.com/scalableminds/webknossos/pull/3883)
- Added merger mode for skeleton and hybrid tracings. It allows to merge segments from e.g. generated segmentations. [#3619](https://github.com/scalableminds/webknossos/pull/3619)
- The HTML template now includes SEO tags for demo instances and hides internal instances from search engines.
- Segmentation ID mappings can now be used in volume and hybrid tracings. [#3949](https://github.com/scalableminds/webknossos/pull/3949)
- A maximize-button was added to the viewports in the annotation view. Maximization can also be toggled with the `.` shortcut. [#3876](https://github.com/scalableminds/webknossos/pull/3876)
- [webknossos-connect](https://github.com/scalableminds/webknossos-connect) now starts with webKnossos on local and development instances by default. [#3913](https://github.com/scalableminds/webknossos/pull/3913)
- The visibilities of trees in a skeleton tracing is now persisted across page loads. [#3942](https://github.com/scalableminds/webknossos/pull/3942)
- Added a button for each color layer to enable/disable the layer. [#3943](https://github.com/scalableminds/webknossos/pull/3943)
- Paginated routes now send a `X-Total-Count` HTTP header which shows how many entries were found in total. [#3899](https://github.com/scalableminds/webknossos/pull/3899)

### Changed
- Improved the flight mode performance for tracings with very large trees (>80.000 nodes). [#3880](https://github.com/scalableminds/webknossos/pull/3880)
- Tweaked the highlighting of the active node. The inner node looks exactly as a non-active node and is not round, anymore. An active node is circled by a "halo". In arbitrary mode, the halo is hidden and the active node is round. [#3868](https://github.com/scalableminds/webknossos/pull/3868)
- Improved the performance of moving through a dataset which should make the overall interaction smoother. [#3902](https://github.com/scalableminds/webknossos/pull/3902)
- Brush size is independent of zoom value, now. This change simplifies volume annotations, as brush sizes can be adapted to certain structures (e.g., vesicles) and don't need to be changed when zooming. [#3868](https://github.com/scalableminds/webknossos/pull/3889)
- Reworked the search in the trees tab. [#3878](https://github.com/scalableminds/webknossos/pull/3878)

### Fixed
- Fixed a bug where failed large save requests lead to inconsistent tracings on the server. [#3829](https://github.com/scalableminds/webknossos/pull/3829)
- Fixed the setting which enables to hide the planes within the 3D viewport. [#3857](https://github.com/scalableminds/webknossos/pull/3857)
- Fixed a bug which allowed the brush size to become negative when using shortcuts. [#3861](https://github.com/scalableminds/webknossos/pull/3861)
- Fixed interpolation along z-axis. [#3888](https://github.com/scalableminds/webknossos/pull/3888)
- Fixed that the halo of the active node could cover other nodes. [#3919](https://github.com/scalableminds/webknossos/pull/3919)
- Fixed that the 3D viewport was partially occluded due to clipping distance issues. [#3919](https://github.com/scalableminds/webknossos/pull/3919)
- Fixed that scrolling with the mouse wheel over a data viewport also scrolled the page. This bug appeared with the new Chrome version 73. [#3939](https://github.com/scalableminds/webknossos/pull/3939)

### Removed
- Removed FPS meter in Annotation View. [#3916](https://github.com/scalableminds/webknossos/pull/3916)


## [19.03.0](https://github.com/scalableminds/webknossos/releases/tag/19.03.0) - 2019-03-04
[Commits](https://github.com/scalableminds/webknossos/compare/19.02.0...19.03.0)

### Highlights
- The tracing view got two major improvements:
   - Data rendering is now fully using the available space and doesn't have to be quadratic anymore. Increasing the size of a viewport will result in more data being rendered (as opposed to the same data will be upscaled). [#3634](https://github.com/scalableminds/webknossos/pull/3634)
   - The active node is highlighted with a "halo ring". Additionally, the node is also rendered as a circle. In flight and oblique modes the halo is hidden. [#3731](https://github.com/scalableminds/webknossos/pull/3731)
- Added the possibility to create volume annotation tasks. When creating a task type, select whether to create `volume` or `skeleton` tasks. Compound viewing and file upload for volume tasks is not yet supported. [#3712](https://github.com/scalableminds/webknossos/pull/3712)
- Mappings for segmentations will be read automatically from the file system. It's not necessary to define the mappings within the `datasource-properties.json` anymore. [#3720](https://github.com/scalableminds/webknossos/pull/3720)

### Added
- Added the possibility to create volume annotation tasks. When creating a task type, select whether to create `volume` or `skeleton` tasks. Note that compound viewing for volume tasks is not supported yet. Same for creating volume tasks from uploaded nml/data files. [#3712](https://github.com/scalableminds/webknossos/pull/3712)
- Added an UI to select a mapping for a segmentation layer. The UI is placed in the segmentation tab within the tracing view. [#3720](https://github.com/scalableminds/webknossos/pull/3720)
- Added a button to jump to actual data if the bounding box of a dataset contains a lot of black data. [#3682](https://github.com/scalableminds/webknossos/pull/3682)

### Changed
- Data rendering is not tied to square viewports, anymore. As a result the screen space is used more efficiently to show data. Also, increasing the size of a viewport will result in more data being rendered (as opposed to the same data will be upscaled). [#3634](https://github.com/scalableminds/webknossos/pull/3634)
- Mappings for segmentations will be read automatically from the file system. It's not necessary to define the mappings within the `datasource-properties.json`, anymore. [#3720](https://github.com/scalableminds/webknossos/pull/3720)
- The active node is highlighted with a "halo ring". Additionally, the node is also rendered as a circle. In flight and oblique modes the halo is hidden. [#3731](https://github.com/scalableminds/webknossos/pull/3731)
- In the dashboard list of active tasks, the project name is now featured more prominently, as it switched places with the task type summary. [#3792](https://github.com/scalableminds/webknossos/pull/3792)
- Isosurfaces are now loaded from the middle outwards. [#3818](https://github.com/scalableminds/webknossos/pull/3818)
- The brush size will now be remembered across page reloads. [#3827](https://github.com/scalableminds/webknossos/pull/3827)
- Do not show publication view if no publications are specified. [#3778](https://github.com/scalableminds/webknossos/pull/3778)

### Fixed
- Fixed an error that occured when changing the URL hash. [#3746](https://github.com/scalableminds/webknossos/pull/3746)
- Fixed a bug in the timeline chart rendering. The start and end time of the timeline chart now match the selected time range. [#3772](https://github.com/scalableminds/webknossos/pull/3772)
- The modals for a new task description and recommended task settings are no longer shown in read-only tracings. [#3724](https://github.com/scalableminds/webknossos/pull/3724)
- Fixed a rendering bug when opening a task that only allowed flight/oblique mode tracing. [#3783](https://github.com/scalableminds/webknossos/pull/3783)
- Fixed a bug where some NMLs caused the webKnossos tab to freeze during NML upload. [#3758](https://github.com/scalableminds/webknossos/pull/3758)
- Fixed a bug where some skeleton save requests were wrongly rejected if they were sent more than once. [#3767](https://github.com/scalableminds/webknossos/pull/3767)
- Fixed a bug which caused a wrong aspect ratio in the 3D viewport when changing the layout. [#3817](https://github.com/scalableminds/webknossos/pull/3817)


## [19.02.0](https://github.com/scalableminds/webknossos/releases/tag/19.02.0) - 2019-02-04
[Commits](https://github.com/scalableminds/webknossos/compare/19.01.0...19.02.0)

### Highlights

- The Dataset Gallery was redesigned to be a Publication Gallery instead. It will feature scientific publications together with their published datasets and information such as the species, brain region or acquisition method of such datasets. [#3653](https://github.com/scalableminds/webknossos/pull/3653)
  Please see the [migration guide](MIGRATIONS.md#19020---2019-02-04) on how to add publications.
- Also, this release includes new features that enrich the view of your data:
   - Isosurface computation can now be triggered for whole segments (shift + click on a segment in view mode). [#3655](https://github.com/scalableminds/webknossos/pull/3655)
   - Added the possibility to fade the alpha value of data layers. Also, a dataset can now contain both RGB and grayscale layers. [#3670](https://github.com/scalableminds/webknossos/pull/3670)
- The volume annotation brush tool will now automatically fill any enclosed areas if the brushed outline is closed in one stroke. [#3698](https://github.com/scalableminds/webknossos/pull/3698)
  <img src="https://user-images.githubusercontent.com/1702075/51846983-02d34480-231b-11e9-86f2-2d8c4b0c9bd0.gif" width="200" />


### Added

- Added the possibility to fade the alpha value of data layers. Also, a dataset can now contain both RGB and grayscale layers. [#3670](https://github.com/scalableminds/webknossos/pull/3670)
- Added the possibility to disable that the current layout is saved automatically when changing it. Instead, the layout can be saved explicitly. [#3620](https://github.com/scalableminds/webknossos/pull/3620)
- Added the possibility to use flight and oblique mode when viewing a dataset. [#3644](https://github.com/scalableminds/webknossos/pull/3644)
- Added pagination to the REST API route `GET /projects/:name/tasks` (new optional parameters `limit` and `pageNumber`). [#3659](https://github.com/scalableminds/webknossos/pull/3659)
- Added the possibility to open the version restore view for read-only tracings. Older versions can be previewed and be downloaded as NML. [#3660](https://github.com/scalableminds/webknossos/pull/3660)

### Changed

- Team managers are now also allowed to create and own scripts. [#3676](https://github.com/scalableminds/webknossos/pull/3676)
- The Dataset Gallery was redesigned to be a Publication Gallery instead. It will feature scientific publications together with their published datasets and information such as the species, brain region or acquisition method of such datasets. [#3653](https://github.com/scalableminds/webknossos/pull/3653)
- Annotations for non-public datasets can now be shared using the "Share" functionality without making the dataset public. [#3664](https://github.com/scalableminds/webknossos/pull/3664)
- The volume annotation brush tool will now automatically fill any enclosed areas if the brushed outline is closed in one stroke. [#3698](https://github.com/scalableminds/webknossos/pull/3698)
  <img src="https://user-images.githubusercontent.com/1702075/51846983-02d34480-231b-11e9-86f2-2d8c4b0c9bd0.gif" width="200" />
- Statistics are now separated by organization, rather than showing the webKnossos instance’s totals. [#3663](https://github.com/scalableminds/webknossos/pull/3663)
- NML files can be imported into arbitrary datasets. Users will be asked to confirm the import process if the dataset of the NML differs from the currently active dataset. [#3716](https://github.com/scalableminds/webknossos/pull/3716)

### Fixed

- Fixed a rendering bug which caused data to be clipped in certain scenarios for datasets with anisotropic resolutions. [#3609](https://github.com/scalableminds/webknossos/pull/3609)
- Fixed a bug where saving tracings failed after they were open for >24h. [#3633](https://github.com/scalableminds/webknossos/pull/3633)
- Fixed a bug that resulted in slow data loading when moving quickly through a dataset. [#3656](https://github.com/scalableminds/webknossos/pull/3656)
- Fixed a bug which caused the wrong magnification to be rendered when zooming out very far. [#3641](https://github.com/scalableminds/webknossos/pull/3641)
- Fixed a bug which broke the functionality to toggle the visibility of a tree in a skeleton tracing. [#3719](https://github.com/scalableminds/webknossos/pull/3719)

## [19.01.0](https://github.com/scalableminds/webknossos/releases/tag/19.01.0) - 2019-01-14
[Commits](https://github.com/scalableminds/webknossos/compare/18.12.0...19.01.0)

### Highlights

- You can now create tracings on datasets of other organizations, provided you have access rights to the dataset (i.e. it is public). [#3533](https://github.com/scalableminds/webknossos/pull/3533)
- Added the experimental feature to dynamically render isosurfaces for segmentation layers (can be enabled in the dataset settings when viewing a dataset). [#3495](https://github.com/scalableminds/webknossos/pull/3495)
- Added the possibility to specify a recommended user configuration in a task type. The recommended configuration will be shown to users when they trace a task with a different task type and the configuration can be accepted or declined. [#3466](https://github.com/scalableminds/webknossos/pull/3466)
- Added the possibility to select multiple trees in skeleton tracings in the tree tab by using ctrl + left mouse. Deleting and moving trees will affect all selected trees. [#3457](https://github.com/scalableminds/webknossos/pull/3457)

### Added

- Added the possibility to select multiple trees in skeleton tracings in the tree tab by using ctrl + left mouse. Deleting and moving trees will affect all selected trees. [#3457](https://github.com/scalableminds/webknossos/pull/3457)
- Added the possibility to specify a recommended user configuration in a task type. The recommended configuration will be shown to users when they trace a task with a different task type and the configuration can be accepted or declined. [#3466](https://github.com/scalableminds/webknossos/pull/3466)
- You can now create tracings on datasets of other organizations, provided you have access rights to the dataset (i.e. it is public). [#3533](https://github.com/scalableminds/webknossos/pull/3533)
- Datasets imported through a datastore that is marked as 'scratch' will now show a construction-like header and error message to encourage moving the datasets to a permanent storage location. [#3500](https://github.com/scalableminds/webknossos/pull/3500)
- Added the experimental feature to dynamically render isosurfaces for segmentation layers (can be enabled in the dataset settings when viewing a dataset). [#3495](https://github.com/scalableminds/webknossos/pull/3495)
- Adds healthchecks to all Dockerfiles for automatic service healing [#3606](https://github.com/scalableminds/webknossos/pull/3606)
- Added possibility to load more tasks or explorative annotations in the dashboard. [#3505](https://github.com/scalableminds/webknossos/pull/3505)
- Adds a second colorful thumbnail for the datasets which have a segmentation layer and this segmentation thumbnail will be shown on hover over the other thumbnail. [#3507](https://github.com/scalableminds/webknossos/pull/3507)

### Fixed

- Fixed a performance issue for large tracings with many branch points. [#3519](https://github.com/scalableminds/webknossos/pull/3519)
- Fixed bug which caused buckets to disappear randomly. [#3531](https://github.com/scalableminds/webknossos/pull/3531)
- Fixed a bug which broke the redirect after dataset upload via GUI. [#3571](https://github.com/scalableminds/webknossos/pull/3571)

## [18.12.0](https://github.com/scalableminds/webknossos/releases/tag/18.12.0) - 2018-11-26
[Commits](https://github.com/scalableminds/webknossos/compare/18.11.0...18.12.0)

### Highlights

- Added the possibility to add STL mesh files to tracings. [#3367](https://github.com/scalableminds/webknossos/pull/3367)
- Improved support for datasets with a large skew in scale. [#3398](https://github.com/scalableminds/webknossos/pull/3398)
- Improved performance for flight mode. [#3392](https://github.com/scalableminds/webknossos/pull/3392)
- Fixed the guessed bounding box for datasets that do not start at (0,0,0). [#3437](https://github.com/scalableminds/webknossos/pull/3437)

### Added

- Added the possibility to add STL mesh files to tracings. [#3367](https://github.com/scalableminds/webknossos/pull/3367)

### Changed

- Improved support for datasets with a large skew in scale (e.g., [600, 600, 35]). [#3398](https://github.com/scalableminds/webknossos/pull/3398)
- Improved performance for flight mode. [#3392](https://github.com/scalableminds/webknossos/pull/3392)

### Fixed

- Fixed a bug where the initial onboarding setup failed if automatic initial data was disabled. [#3421](https://github.com/scalableminds/webknossos/pull/3421)
- Fixed a permission issue in the try setup.
- Fixed a bug where the guessed bounding box for datasets that do not start at (0,0,0) was too large. [#3437](https://github.com/scalableminds/webknossos/pull/3437)
- Fixed a bug where dataset list refresh failed when datasets for non-existing organizations were reported. [#3438](https://github.com/scalableminds/webknossos/pull/3438)
- Editing team access rights for datasets now works even if the datastore has no disk write access. [#3411](https://github.com/scalableminds/webknossos/pull/3411)
- Fixed a bug where the form values when editing TaskTypes were missing. [#3451](https://github.com/scalableminds/webknossos/pull/3451)
- Fixed a bug which caused RGB data to not render correctly. [#3455](https://github.com/scalableminds/webknossos/pull/3455)

### Removed

- Removed support to watch additional dataset directories, no longer automatically creating symbolic links to the main directory. [#3416](https://github.com/scalableminds/webknossos/pull/3416)

## [18.11.0](https://github.com/scalableminds/webknossos/releases/tag/18.11.0) - 2018-10-29

[Commits](https://github.com/scalableminds/webknossos/compare/18.10.0...18.11.0)

### Highlights

- Skeleton and volume tracings will be more unified, resulting in hybrid tracings that can contain both structures:
  - Hybrid tracings are now enabled by default. They allow to combine the functionality of skeleton and volume annotations in one tracing. [#3399](https://github.com/scalableminds/webknossos/pull/3399)
  - Old volume tracing versions now also can be restored. Access it through the dropdown next to the Save button. [#3349](https://github.com/scalableminds/webknossos/pull/3349)
- The tracing view was improved:
  - The info tab in tracing views now displays the extent of the current dataset. [#3371](https://github.com/scalableminds/webknossos/pull/3371).
  - A User can now have multiple layouts for tracing views. [#3299](https://github.com/scalableminds/webknossos/pull/3299)
  - More layouting improvements: [#3256](https://github.com/scalableminds/webknossos/pull/3256) [#3256](https://github.com/scalableminds/webknossos/pull/3256) [#3272](https://github.com/scalableminds/webknossos/pull/3272)

### Added

- Added support for duplicate dataset names for different organizations. [#3137](https://github.com/scalableminds/webknossos/pull/3137)
- Extended the version restore view and added a view to restore older versions of a volume tracing. Access it through the dropdown next to the Save button. [#3349](https://github.com/scalableminds/webknossos/pull/3349)
- Added support to watch additional dataset directories, automatically creating symbolic links to the main directory. [#3330](https://github.com/scalableminds/webknossos/pull/3330)
- Added a button to the users list view that revokes admin rights from all selected users. [#3378](https://github.com/scalableminds/webknossos/pull/3378)
- Hybrid tracings are now enabled by default. They allow to combine the functionality of skeleton and volume annotations in one tracing. [#3399](https://github.com/scalableminds/webknossos/pull/3399)
- A User can now have multiple layouts for tracing views. [#3299](https://github.com/scalableminds/webknossos/pull/3299)
- Added support for datasets with sparse resolutions (e.g., [[1, 1, 1], [16, 16, 16]]). [#3406](https://github.com/scalableminds/webknossos/pull/3406)
- The info tab in tracing views now displays the extent of the current dataset. [#3371](https://github.com/scalableminds/webknossos/pull/3371).

### Changed

- The UI for editing experience domains of users was improved. [#3254](https://github.com/scalableminds/webknossos/pull/3254)
- The tracing layout was changed to be more compact. [#3256](https://github.com/scalableminds/webknossos/pull/3256)
- It is no longer possible to draw outside of a viewport with the brush tool in volume tracing. [#3283](https://github.com/scalableminds/webknossos/pull/3283)
- There is now a separate tracingstore module, the datastore is no longer responsible for saving tracings. [#3281](https://github.com/scalableminds/webknossos/pull/3281)
- The version history view shows versions grouped by day and time now. [#3365](https://github.com/scalableminds/webknossos/pull/3365)
- Users can now access the annotations of other users (of the same organization) given the link, even if they are non-public. [#3348](https://github.com/scalableminds/webknossos/pull/3348)

### Fixed

- Fixed a layouting issue which occurred on a fresh page load when the layout was scaled to be bigger than the available space. [#3256](https://github.com/scalableminds/webknossos/pull/3256)
- Fixed overlap in comment tab for long tree names or comments. [#3272](https://github.com/scalableminds/webknossos/pull/3272)
- Fixed that CTRL + Shift + F opens two search popovers in the tracing view. Instead, the shortcut will only open the tree search now. [#3407](https://github.com/scalableminds/webknossos/pull/3407)
- Fixed a bug which caused data to not be displayed correctly if adjacent data does not exist.[#3270](https://github.com/scalableminds/webknossos/pull/3270)
- Fixed a bug which caused data to not be displayed correctly if adjacent data does not exist. [#3270](https://github.com/scalableminds/webknossos/pull/3270)
- Fixed a bug which caused initial rendering to sometimes miss some buckets. [#3262](https://github.com/scalableminds/webknossos/pull/3262)
- Fixed a bug which caused the save-button to never show success for volume tracings. [#3267](https://github.com/scalableminds/webknossos/pull/3267)
- Fixed a rendering bug which caused data to turn black sometimes when moving around. [#3409](https://github.com/scalableminds/webknossos/pull/3409)

## [18.10.0](https://github.com/scalableminds/webknossos/releases/tag/18.10.0) - 2018-09-22

[Commits](https://github.com/scalableminds/webknossos/compare/18.09.0...18.10.0)

### Highlights

- WebKnossos is documented now! Check it out: https://docs.webknossos.org [#3011](https://github.com/scalableminds/webknossos/pull/3011)
- There are multiple improvements of the tracing view:
  - Added customizable layouting to the tracing view. [#3070](https://github.com/scalableminds/webknossos/pull/3070)
  - Improved general performance of the tracing view by leveraging web workers. [#3162](https://github.com/scalableminds/webknossos/pull/3162)
  - Added a view to restore any older version of a skeleton tracing. Access it through the dropdown next to the Save button. [#3194](https://github.com/scalableminds/webknossos/pull/3194)
  - And more usability improvements: [#3126](https://github.com/scalableminds/webknossos/pull/3126), [#3066](https://github.com/scalableminds/webknossos/pull/3066)
- Project administration got some UI improvements: [#3077](https://github.com/scalableminds/webknossos/pull/3077), [#3224](https://github.com/scalableminds/webknossos/pull/3224), [#3233](https://github.com/scalableminds/webknossos/pull/3233)
- Improved security by enabling http security headers. [#3084](https://github.com/scalableminds/webknossos/pull/3084)

### Added

- Added URLs to the tabs in the dashboard. [#3183](https://github.com/scalableminds/webknossos/pull/3183)
- Improved security by enabling http security headers. [#3084](https://github.com/scalableminds/webknossos/pull/3084)
- Added the possibility to write markdown in the annotation description. [#3081](https://github.com/scalableminds/webknossos/pull/3081)
- Added a view to restore any older version of a skeleton tracing. Access it through the dropdown next to the Save button. [#3194](https://github.com/scalableminds/webknossos/pull/3194)
  ![version-restore-highlight](https://user-images.githubusercontent.com/1702075/45428378-6842d380-b6a1-11e8-88c2-e4ffcd762cd5.png)
- Added customizable layouting to the tracing view. [#3070](https://github.com/scalableminds/webknossos/pull/3070)
- Added the brush size to the settings on the left in volume tracing. The size can now also be adjusted by using only the keyboard. [#3126](https://github.com/scalableminds/webknossos/pull/3126)
- Added a user documentation for webKnossos [#3011](https://github.com/scalableminds/webknossos/pull/3011)
- Tree groups can now be activated. This allows to rename a tree group analogous to renaming a tree. Also, toggling the visibility of a tree group can now be done by using the shortcuts "1" and "2". [#3066](https://github.com/scalableminds/webknossos/pull/3066)
- Added the possibility to upload multiple NML files during task creation, even if they are not in a zip archive
- Added the possibility to supply a dedicated "sorting date" for datasets to change the sorting order in the gallery view, by default the creation date is used [#3124](https://github.com/scalableminds/webknossos/pull/3124)
- Added bar-chart visualization to project progress report. [#3224](https://github.com/scalableminds/webknossos/pull/3224)
- Added a button to collapse all comments. [#3215](https://github.com/scalableminds/webknossos/pull/3215)
- The datasets in the dashboard are now sorted according to their user-specific usage. As a result, relevant datasets should appear at the top of the list. [#3206](https://github.com/scalableminds/webknossos/pull/3206)
- 3D Meshes can now be imported into the tracing view by uploading corresponding STL files. [#3242](https://github.com/scalableminds/webknossos/pull/3242)

### Changed

- The modal used to change the experience of users by admins got a rework. [#3077](https://github.com/scalableminds/webknossos/pull/3077)
- During task creation, specifying an experience domain is now possible by choosing from existing domains. [#3233](https://github.com/scalableminds/webknossos/pull/3233)
- Unified the search functionality within webKnossos to implement an AND logic everyhwere. [#3228](https://github.com/scalableminds/webknossos/pull/3228)
- Renamed "Soma Clicking" to "Single-Node-Tree Mode". [#3141](https://github.com/scalableminds/webknossos/pull/3141/files)
- The fallback segmentation layer attribute of volume tracings is now persisted to NML/ZIP files. Upon re-upload, only volume tracings with this attribute will show a fallback layer. Use `tools/volumeAddFallbackLayer.py` to add this attribute to existing volume tracings. [#3088](https://github.com/scalableminds/webknossos/pull/3088)
- When splitting a tree, the split part that contains the initial node will now keep the original tree name and id. [#3145](https://github.com/scalableminds/webknossos/pull/3145)
- Improve error messages for parsing faulty NMLs. [#3227](https://github.com/scalableminds/webknossos/pull/3227)
- Finished tasks will be displayed with less details and sorted by their finishing date in the dashboard. [#3202](https://github.com/scalableminds/webknossos/pull/3202)
- Improved layouting for narrow screens. [#3226](https://github.com/scalableminds/webknossos/pull/3226)
- The welcome header will now also show on the default page if there are no existing organisations. [#3133](https://github.com/scalableminds/webknossos/pull/3133)
- Simplified the sharing of tracings. Users can simply copy the active URL from the browser's URL bar to share a tracing (assuming the tracing is public). [#3176](https://github.com/scalableminds/webknossos/pull/3176)
- Improved general performance of the tracing view by leveraging web workers. [#3162](https://github.com/scalableminds/webknossos/pull/3162)
- Improved overall drag-and-drop behavior by preventing the browser from opening the dragged file when the actual drag target was missed. [#3222](https://github.com/scalableminds/webknossos/pull/3222)
- The checkboxes in the user list view will clear now after the experience domains of users have been changed. [#3178](https://github.com/scalableminds/webknossos/pull/3178)
- Resetting a user's task requires a confirmation now. [#3181](https://github.com/scalableminds/webknossos/pull/3181)

### Fixed

- Fixed a bug where large volume downloads contained invalid data.zip archives. [#3086](https://github.com/scalableminds/webknossos/pull/3086)
- Fixed the sorting of the dashboard task list and explorative annotation list. [#3153](https://github.com/scalableminds/webknossos/pull/3153)
- Fixed a missing notification when a task annotation was reset. [#3207](https://github.com/scalableminds/webknossos/pull/3207)
- Fixed a bug where non-privileged users were wrongly allowed to pause/unpause projects. [#3097](https://github.com/scalableminds/webknossos/pull/3097)
- Fixed a bug in copy-segmentation-slice feature. [#3245](https://github.com/scalableminds/webknossos/pull/3245)
- Fixed a regression bug which caused the initial data loading to fail sometimes. [#3149](https://github.com/scalableminds/webknossos/pull/3149)
- Fixed a bug which caused a blank screen sometimes when the user is not logged in. [#3167](https://github.com/scalableminds/webknossos/pull/3167)
- Fixed a bug where NML downloads of Task Annotations failed. [#3166](https://github.com/scalableminds/webknossos/pull/3166)
- Fixed a bug where viewing Compound Annotations (such as all tasks for a project in one view) failed. [#3174](https://github.com/scalableminds/webknossos/pull/3174)

### Removed

- Removed the automatic redirect to the onboarding page from the default page if there are no existing organisations. [#3133](https://github.com/scalableminds/webknossos/pull/3133)

## [18.09.0](https://github.com/scalableminds/webknossos/releases/tag/18.09.0) - 2018-08-20

[Commits](https://github.com/scalableminds/webknossos/compare/18.08.0...18.09.0)

### Highlights

- The dashboard gallery loads faster [#3036](https://github.com/scalableminds/webknossos/pull/3036) and tracings in the dashboard can show their descriptions [#3035](https://github.com/scalableminds/webknossos/pull/3035).
- Managing new users got easier through "new inactive users" notifications [#2994](https://github.com/scalableminds/webknossos/pull/2994), and also team managers can activate them now [#3050](https://github.com/scalableminds/webknossos/pull/3050).
- Improved the UI for sharing datasets and tracings [#3029](https://github.com/scalableminds/webknossos/pull/3029).
- The tracing view got a progress-indicator [#2935](https://github.com/scalableminds/webknossos/pull/2935) and scale-bars [#3049](https://github.com/scalableminds/webknossos/pull/3049).
- When merging datasets within a tracing via the merge-modal, the user can choose whether the merge should be executed directly in the currently opened tracing. Alternatively, a new annotation can be created which is accessible via the dashboard, as before [#2935](https://github.com/scalableminds/webknossos/pull/2935).

### Added

- Added two new properties to mapping json files. The `colors: [<hsvHueValue1>, <hsvHueValue2>, ...]` property can be used to specify up to 256 custom colors for the first 256 equivalence classes of the mapping. The `hideUnmappedIds: <true|false>` property indicates whether segments that were not mapped should be rendered transparently or not. [#2965](https://github.com/scalableminds/webknossos/pull/2965)
- Added a button for refreshing the dataset in the backend cache. [#2975](https://github.com/scalableminds/webknossos/pull/2975)
- Added the possibility to see the description of a tracing within the dashboard. [#3035](https://github.com/scalableminds/webknossos/pull/3035)
- Comments of tracing trees can now be cycled through by keeping n and p pressed. [#3041](https://github.com/scalableminds/webknossos/pull/3041)
- All dates in webknossos will be shown in the browser's timezone. On hover, a tooltip will show the date in UTC. [#2916](https://github.com/scalableminds/webknossos/pull/2916) ![image](https://user-images.githubusercontent.com/2486553/42888385-74c82bc0-8aa8-11e8-9c3e-7cfc90ce93bc.png)
- When merging datasets within a tracing via the merge-modal, the user can choose whether the merge should be executed directly in the currently opened tracing. Alternatively, a new annotation can be created which is accessible via the dashboard (as it has been before).
- Added shortcuts for moving along the current tracing direction in orthogonal mode. Pressing 'e' (and 'r' for the reverse direction) will move along the "current direction", which is defined by the vector between the last two created nodes.
- Added a banner to the user list to notify admins of new inactive users that need to be activated. [#2994](https://github.com/scalableminds/webknossos/pull/2994)
- When a lot of changes need to be persisted to the server (e.g., after importing a large NML), the save button will show a percentage-based progress indicator.
- Changing tabs in a tracing view will not disable the keyboard shortcuts anymore. [#3042](https://github.com/scalableminds/webknossos/pull/3042)
- Added the possibility for admins to see and transfer all active tasks of a project to a single user in the project tab[#2863](https://github.com/scalableminds/webknossos/pull/2863)
- Added the possibility to import multiple NML files into the active tracing. This can be done by dragging and dropping the files directly into the tracing view. [#2908](https://github.com/scalableminds/webknossos/pull/2908)
- Added placeholders and functionality hints to (nearly) empty lists and tables in the admin views. [#2969](https://github.com/scalableminds/webknossos/pull/2969)
- Added the possibility to copy volume tracings to own account
- During the import of multiple NML files, the user can select an option to automatically create a group per file so that the imported trees are organized in a hierarchy. [#2908](https://github.com/scalableminds/webknossos/pull/2908)
- Added the option to display scale bars in the viewports for orthogonal mode. [#3049](https://github.com/scalableminds/webknossos/pull/3049)
- Added functions to the front-end API to activate a tree and to change the color of a tree. [#2997](https://github.com/scalableminds/webknossos/pull/2997)
- When a new team or project is created, invalid names will be directly marked in red. [#3034](https://github.com/scalableminds/webknossos/pull/3034)
- Added an error message to the NML upload if the needed permissions are missing for the upload. [#3051](https://github.com/scalableminds/webknossos/pull/3051)
- Comments can now contain references to nodes (`#<nodeid>`) or positions (`#(<x,y,z>)`). Clicking on such a reference activates the respective node or position and centers it. [#2950](https://github.com/scalableminds/webknossos/pull/2950)
- Added a default text to the task view to indicate, that no users are assigned to a task. [#3030](https://github.com/scalableminds/webknossos/issues/3030)

### Changed

- Added a checkbox to disable the warning when deleting a tree. An accidentally deleted tree can easily be restored using the Undo functionality. [#2995](https://github.com/scalableminds/webknossos/pull/2995)
- Improved the UI for sharing datasets and tracings. [#3029](https://github.com/scalableminds/webknossos/pull/3029)
- Team managers are now allowed to activate users (previously admin-only) [#3050](https://github.com/scalableminds/webknossos/pull/3050)
- Improved the loading time of datasets in the dashboard. [#3036](https://github.com/scalableminds/webknossos/pull/3036)

### Fixed

- Fixed a bug where unloaded data was sometimes shown as black instead of gray. [#2963](https://github.com/scalableminds/webknossos/pull/2963)
- Fixed that URLs linking to a certain position in a dataset or tracing always led to the position of the active node. [#2960](https://github.com/scalableminds/webknossos/pull/2960)
- Fixed that setting a bounding box in view mode did not work. [#3015](https://github.com/scalableminds/webknossos/pull/3015)
- Fixed a bug where viewing Compound Annotations (such as viewing all instances of a task at once) failed with a permission issue. [#3023](https://github.com/scalableminds/webknossos/pull/3023)
- Fixed that the segmentation layer is loaded from the server even when the segmentation opacity is set to 0. [#3067](https://github.com/scalableminds/webknossos/pull/3067)
- Fixed a bug where the team name was not displayed in the task types view of admins. [#3053](https://github.com/scalableminds/webknossos/pull/3053)

## [18.08.0](https://github.com/scalableminds/webknossos/releases/tag/18.08.0) - 2018-07-23

[Commits](https://github.com/scalableminds/webknossos/compare/18.07.0...18.08.0)

### Highlights

- Performance improvements for the tracing views. #2709 #2724 #2821
- Added onboarding flow for initial setup of WebKnossos. #2859
- The dataset gallery got a redesign with mobile support. #2761
- Improved the import dialog for datasets. Important fields can now be edited via form inputs instead of having to change the JSON. The JSON is still changeable when enabling an "Advanced" mode. #2881
- Added possibility to share a special link to invite users to join your organization. Following that link, the sign-up form will automatically register the user for the correct organization. #2898

### Added

- Added release version to navbar [#2888](https://github.com/scalableminds/webknossos/pull/2888)
- Users can view datasets in a table from the dashboard. That view also allows to create explorational tracings (which had to be done via the gallery view for non-admins before). [#2866](https://github.com/scalableminds/webknossos/pull/2866)
- Added the task bounding box of a skeleton tracing to NML files. [#2827](https://github.com/scalableminds/webknossos/pull/2827) \
   Example: `<taskBoundingBox topLeftX="0" topLeftY="0" topLeftZ="0" width="512" height="512" depth="512" />`
- Added the possibility to kick a user out of the organization team. [#2801](https://github.com/scalableminds/webknossos/pull/2801)
- Added a mandatory waiting interval of 10 seconds when getting a task with a new task type. The modal containing the task description cannot be closed earlier. These ten seconds should be used to fully understand the new task type. [#2793](https://github.com/scalableminds/webknossos/pull/2793)
- Added possibility to share a special link to invite users to join your organization. Following that link, the sign-up form will automatically register the user for the correct organization. [#2898](https://github.com/scalableminds/webknossos/pull/2898)
- Added more debugging related information in case of unexpected errors. The additional information can be used when reporting the error. [#2766](https://github.com/scalableminds/webknossos/pull/2766)
- Added permission for team managers to create explorational tracings on datasets without allowed teams. [#2758](https://github.com/scalableminds/webknossos/pull/2758)
- Added higher-resolution images for dataset gallery thumbnails. [#2745](https://github.com/scalableminds/webknossos/pull/2745)
- Added permission for admins to get tasks from all projects in their organization. [#2728](https://github.com/scalableminds/webknossos/pull/2728)
- Added the shortcut to copy the currently hovered cell id (CTRL + I) to non-volume-tracings, too. [#2726](https://github.com/scalableminds/webknossos/pull/2726)
- Added permission for team managers to refresh datasets. [#2688](https://github.com/scalableminds/webknossos/pull/2688)
- Added backend-unit-test setup and a first test for NML validation. [#2829](https://github.com/scalableminds/webknossos/pull/2829)
- Added progress indicators to the save button for cases where the saving takes some time (e.g., when importing a large NML). [#2947](https://github.com/scalableminds/webknossos/pull/2947)
- Added the possibility to not sort comments by name. When clicking the sort button multiple times, sorting is switched to sort by IDs. [#2915](https://github.com/scalableminds/webknossos/pull/2915)
- Added displayName for organizations. [#2869](https://github.com/scalableminds/webknossos/pull/2869)
- Added onboarding flow for initial setup of WebKnossos. [#2859](https://github.com/scalableminds/webknossos/pull/2859)
- Added the possibility to show the task in a random order. [#2860](https://github.com/scalableminds/webknossos/pull/2860)

### Changed

- Improved the search functionality in the datasets view. The datasets will be sorted so that the best match is shown first. If a different sorting is desired, the sorting-arrows in the columns can still be used to change the sorting criteria. [#2834](https://github.com/scalableminds/webknossos/pull/2834)
- Improved performance in orthogonal mode. [#2821](https://github.com/scalableminds/webknossos/pull/2821)
- When deleting the last node of a tree, that tree will not be removed automatically anymore. Instead, the tree will just be empty. To remove that active tree, the "delete" shortcut can be used again. [#2806](https://github.com/scalableminds/webknossos/pull/2806)
- Renamed "Cancel" to "Reset and Cancel" for tasks. [#2910](https://github.com/scalableminds/webknossos/pull/2910)
- Changed the type of the initial node of new tasks to be a branchpoint (if not created via NML). [#2799](https://github.com/scalableminds/webknossos/pull/2799)
- The dataset gallery got a redesign with mobile support. [#2761](https://github.com/scalableminds/webknossos/pull/2761)
- Improved the performance of saving large changes to a tracing (e.g., when importing a large NML). [#2947](https://github.com/scalableminds/webknossos/pull/2947)
- Improved loading speed of buckets. [#2724](https://github.com/scalableminds/webknossos/pull/2724)
- Changed the task search, when filtered by user, to show all instead of just active tasks (except for canceled tasks). [#2774](https://github.com/scalableminds/webknossos/pull/2774)
- Improved the import dialog for datasets. Important fields can now be edited via form inputs instead of having to change the JSON. The JSON is still changeable when enabling an "Advanced" mode. [#2881](https://github.com/scalableminds/webknossos/pull/2881)
- Hid old paused projects in the project progress report even if they have open instances. [#2768](https://github.com/scalableminds/webknossos/pull/2768)
- Excluded canceled tasks and base tracings from the list at `api/projects/:name/usersWithOpenTasks`. [#2765](https://github.com/scalableminds/webknossos/pull/2765)
- Streamlined the order in which initial buckets are loaded when viewing a dataset. [#2749](https://github.com/scalableminds/webknossos/pull/2749)
- Reduced the number of scenarios in which segmentation-related warnings are shown (e.g, not for skeleton tracings when there are multiple resolutions for segmentations anyway). [#2715](https://github.com/scalableminds/webknossos/pull/2715)
- Email addresses for notifications about new users and about task overtime are no longer specified instance-wide but once per organization. [#2939](https://github.com/scalableminds/webknossos/pull/2939)
- Improved tracing view page load performance by decreasing WebGL shader compilation time. [#2709](https://github.com/scalableminds/webknossos/pull/2709)
- Improved error reporting for project progress page. [#2955](https://github.com/scalableminds/webknossos/pull/2955)
- Redesigned the user task list to make it easier to read the whole task description. [#2861](https://github.com/scalableminds/webknossos/pull/2861)

### Fixed

- Fixed a bug which caused segmentation data to be requested as four-bit when four-bit-mode was enabled. [#2828](https://github.com/scalableminds/webknossos/pull/2828)
- Fixed a bug where possible comments or branchpoints sometimes were not properly deleted when deleting a node. [2897](https://github.com/scalableminds/webknossos/pull/2897)
- Fixed a bug which caused projects to be unpaused when the project priority was changed. [#2795](https://github.com/scalableminds/webknossos/pull/2795)
- Fixed an unnecessary warning when deleting a tree in a task, that warned about deleting the initial node although the initial node was not contained in the deleted tree. [#2812](https://github.com/scalableminds/webknossos/pull/2812)
- Fixed a bug where the comment tab was scrolled into view horizontally if a node with a comment was activated. [#2805](https://github.com/scalableminds/webknossos/pull/2805)
- Fixed a bug in for Firefox users where a long tree list created an unnecessary scroll region. [#2787](https://github.com/scalableminds/webknossos/pull/2787)
- Fixed clicking on a task type within the task list page, so that the task type page will actually only show the linked task type. [#2769](https://github.com/scalableminds/webknossos/pull/2769)
- Fixed clicking on a project within the task list page, so that the project page will actually only show the linked project. [#2759](https://github.com/scalableminds/webknossos/pull/2759)
- Fixed a bug in the front-end API's `setMapping` call which caused ignored calls if the provided object was mutated. [#2921](https://github.com/scalableminds/webknossos/pull/2921)
- Fixed a bug where cell IDs in the segmentation tab were not shown for all zoomsteps. [#2726](https://github.com/scalableminds/webknossos/pull/2726)
- Fixed the naming of the initial tree in tasks. [#2689](https://github.com/scalableminds/webknossos/pull/2689)
- Fixed a regression affecting node selection, shortcuts and 3d viewport navigation. [#2673](https://github.com/scalableminds/webknossos/pull/2673)
- Fixed the dataset zip upload for datasets, which only have one data layer and no config file. [#2840](https://github.com/scalableminds/webknossos/pull/2840)
- Fixed a bug where task deletion broke the task listing for users who had active annotations for the task [#2884](https://github.com/scalableminds/webknossos/pull/2884)
- Fixed that decimal scales (e.g., 11.24, 11.24, 30) couldn't be defined for datasets in "simple" mode. [#2912](https://github.com/scalableminds/webknossos/pull/2912)

## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05

First release
