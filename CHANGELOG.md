# Changelog
All notable user-facing changes to webknossos are documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.md).


## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/18.09.0...HEAD)

### Added

- Improved security by enabling http security headers. [#3084](https://github.com/scalableminds/webknossos/pull/3084)
- Added the possibility to write markdown in the annotation description. [#3081](https://github.com/scalableminds/webknossos/pull/3081)
- Added the brush size to the settings on the left in volume tracing. The size can now also be adjusted by using only the keyboard. [#3126](https://github.com/scalableminds/webknossos/pull/3126)
- Added a user documentation for webKnossos [#3011](https://github.com/scalableminds/webknossos/pull/3011)
- Tree groups can now be activated. This allows to rename a tree group analogous to renaming a tree. Also, toggling the visibility of a tree group can now be done by using the shortcuts "1" and "2". [#3066](https://github.com/scalableminds/webknossos/pull/3066)

### Changed

- The fallback segmentation layer attribute of volume tracings is now persisted to NML/ZIP files. Upon re-upload, only volume tracings with this attribute will show a fallback layer. Use `tools/volumeAddFallbackLayer.py` to add this attribute to existing volume tracings. [#3088](https://github.com/scalableminds/webknossos/pull/3088)
- When splitting a tree, the split part that contains the initial node will now keep the original tree name and id. [#3145](https://github.com/scalableminds/webknossos/pull/3145)
- The welcome header will now also show on the default page if there are no existing organisations. [#3133](https://github.com/scalableminds/webknossos/pull/3133)

### Fixed

- Fixed a bug where large volume downloads contained invalid data.zip archives. [#3086](https://github.com/scalableminds/webknossos/pull/3086)
- Fixed the sorting of the dashboard task list and explorative annotation list. [#3153](https://github.com/scalableminds/webknossos/pull/3153)
- Fixed a bug where non-privileged users were wrongly allowed to pause/unpause projects. [#3097](https://github.com/scalableminds/webknossos/pull/3097)
- Fixed a regression bug which caused the initial data loading to fail sometimes. [#3149](https://github.com/scalableminds/webknossos/pull/3149)
- Fixed a bug which caused a blank screen sometimes when the user is not logged in. [#3167](https://github.com/scalableminds/webknossos/pull/3167)
- Fixed a bug where NML downloads of Task Annotations failed. [#3166](https://github.com/scalableminds/webknossos/pull/3166)

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
