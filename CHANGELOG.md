# Changelog

All notable user-facing changes to webknossos are documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/18.12.0...HEAD)

### Added

- Added the possibility to specify a recommended user configuration in a task type. The recommended configuration will be shown to users when they trace a task with a different task type and the configuration can be accepted or declined. [#3466](https://github.com/scalableminds/webknossos/pull/3466)
- You can now create tracings on datasets of other organizations, provided you have access rights to the dataset (i.e. it is public). [#3533](https://github.com/scalableminds/webknossos/pull/3533)
- Added the experimental feature to dynamically render isosurfaces for segmentation layers (can be enabled in the dataset settings when viewing a dataset). [#3533](https://github.com/scalableminds/webknossos/pull/3495)

### Changed

-

### Fixed

- Fixed a performance issue for large tracings with many branch points. [#3519](https://github.com/scalableminds/webknossos/pull/3519)
- Fixed bug which caused buckets to disappear randomly. [#3531](https://github.com/scalableminds/webknossos/pull/3531)
- Fixed a bug which broke the redirect after dataset upload via GUI. [#3571](https://github.com/scalableminds/webknossos/pull/3571)

### Removed

-


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
