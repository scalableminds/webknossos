# Changelog
All notable user-facing changes to webknossos are documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.md).

## [Unreleased]
[Commits](https://github.com/scalableminds/webknossos/compare/18.07.0...HEAD)

### Added

  - Added release version to navbar [#2888](https://github.com/scalableminds/webknossos/pull/2888)
  - Users can view datasets in a table from the dashboard. That view also allows to create explorational tracings (which had to be done via the gallery view for non-admins before). [#2866](https://github.com/scalableminds/webknossos/pull/2866)
  - Added the task bounding box of a skeleton tracing to NML files. [#2827](https://github.com/scalableminds/webknossos/pull/2827) \
    Example: `<taskBoundingBox topLeftX="0" topLeftY="0" topLeftZ="0" width="512" height="512" depth="512" />`
  - Added the possibility to kick a user out of the organization team. [#2801](https://github.com/scalableminds/webknossos/pull/2801)
  - All dates in webknossos will be shown in the browser's timezone. On hover, a tooltip will show the date in UTC. [#2916](https://github.com/scalableminds/webknossos/pull/2916) ![image](https://user-images.githubusercontent.com/2486553/42888385-74c82bc0-8aa8-11e8-9c3e-7cfc90ce93bc.png)
  - Added a mandatory waiting interval of 10 seconds when getting a task with a new task type. The modal containing the task description cannot be closed earlier. These ten seconds should be used to fully understand the new task type. [#2793](https://github.com/scalableminds/webknossos/pull/2793)
  - Added more debugging related information in case of unexpected errors. The additional information can be used when reporting the error. [#2766](https://github.com/scalableminds/webknossos/pull/2766)
  - Added permission for team managers to create explorational tracings on datasets without allowed teams. [#2758](https://github.com/scalableminds/webknossos/pull/2758)
  - Added higher-resolution images for dataset gallery thumbnails. [#2745](https://github.com/scalableminds/webknossos/pull/2745)
  - Added permission for admins to get tasks from all projects in their organization. [#2728](https://github.com/scalableminds/webknossos/pull/2728)
  - Added the shortcut to copy the currently hovered cell id (CTRL + I) to non-volume-tracings, too. [#2726](https://github.com/scalableminds/webknossos/pull/2726)
  - Added permission for team managers to refresh datasets. [#2688](https://github.com/scalableminds/webknossos/pull/2688)
  - Added backend-unit-test setup and a first test for NML validation. [#2829](https://github.com/scalableminds/webknossos/pull/2829)
  - Added the possibility to not sort comments by name. When clicking the sort button multiple times, sorting is switched to sort by IDs. [#2915](https://github.com/scalableminds/webknossos/pull/2915)
  - Added displayName for organizations. [#2869](https://github.com/scalableminds/webknossos/pull/2869)
  - Added onboarding flow for initial setup of WebKnossos. [#2859](https://github.com/scalableminds/webknossos/pull/2859)
  - Added the possibility to show the task in a random order. [#2860](https://github.com/scalableminds/webknossos/pull/2860)

### Changed

  - Improved the search functionality in the datasets view. The datasets will be sorted so that the best match is shown first. If a different sorting is desired, the sorting-arrows in the columns can still be used to change the sorting criteria. [#2834](https://github.com/scalableminds/webknossos/pull/2834)
  - Improved performance in orthogonal mode. [#2821](https://github.com/scalableminds/webknossos/pull/2821)
  - When deleting the last node of a tree, that tree will not be removed automatically anymore. Instead, the tree will just be empty. To remove that active tree, the "delete" shortcut can be used again. [#2806](https://github.com/scalableminds/webknossos/pull/2806)
  - Changed the type of the initial node of new tasks to be a branchpoint (if not created via NML). [#2799](https://github.com/scalableminds/webknossos/pull/2799)
  - The dataset gallery got a redesign with mobile support. [#2761](https://github.com/scalableminds/webknossos/pull/2761)
  - Improved loading speed of buckets. [#2724](https://github.com/scalableminds/webknossos/pull/2724)
  - Changed the task search, when filtered by user, to show all instead of just active tasks (except for canceled tasks). [#2774](https://github.com/scalableminds/webknossos/pull/2774)
  - Improved the import dialog for datasets. Important fields can now be edited via form inputs instead of having to change the JSON. The JSON is still changeable when enabling an "Advanced" mode. [#2881](https://github.com/scalableminds/webknossos/pull/2881)
  - Hid old paused projects in the project progress report even if they have open instances. [#2768](https://github.com/scalableminds/webknossos/pull/2768)
  - Excluded canceled tasks and base tracings from the list at `api/projects/:name/usersWithOpenTasks`. [#2765](https://github.com/scalableminds/webknossos/pull/2765)
  - Streamlined the order in which initial buckets are loaded when viewing a dataset. [#2749](https://github.com/scalableminds/webknossos/pull/2749)
  - Reduced the number of scenarios in which segmentation-related warnings are shown (e.g, not for skeleton tracings when there are multiple resolutions for segmentations anyway). [#2715](https://github.com/scalableminds/webknossos/pull/2715)
  - Improved tracing view page load performance by decreasing WebGL shader compilation time. [#2709](https://github.com/scalableminds/webknossos/pull/2709)
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


### Removed


## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05

First release
