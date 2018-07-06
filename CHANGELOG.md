# Changelog
All notable user-facing changes to webknossos are documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.md).

## [Unreleased]
[Commits](https://github.com/scalableminds/webknossos/compare/18.07.0...HEAD)

### Added
- Refreshing datasets now works for teamManagers too #2688
- The shortcut to copy the currently hovered cell id (CTRL + I) works in non-volume-tracings, too.
- admins can now get tasks from all projects in their organization
- Team Managers are now allowed to create explorational tracings on datasets without allowed teams
- WebKnossos will show more debugging related information in case of unexpected errors. You can use the additional information when reporting the error.
- Improve loading speed of buckets
- logo which is displayed next to tracing view is now configurable
- It is now possible again to kick a user out of the organization team
- Performance improvements for orthogonal mode.
- Webknossos renders Markdown in View mode

### Changed
- Improved tracing view page load performance by decreasing WebGL shader compilation time.
- Segmentation-related warnings will be shown less frequent (e.g, not for skeleton tracings when there are multiple resolutions for segmentations anyway).
- Use higher-resolution data for gallery thumbnails
- The order in which initial buckets are loaded when viewing a dataset was streamlined.
- the list at `api/projects/:name/usersWithOpenTasks` now ignores cancelled tasks and base tracings
- in progress report, old paused projects are hidden even if they have open instances
- Task search, when filtered by user, now shows all (except cancelled) instead of just active tasks
- The dataset gallery got a redesign with mobile support.
- When getting a new task, the new description is shown in a modal which can only be closed after ten seconds. These ten seconds should be used to fully understand the new task type.
- Initial Node of new tasks (if not created via NML) is now a branchpoint
- When deleting the last node of a tree, that tree will not be removed automatically anymore. Instead, the tree will just be empty. To remove that active tree, the "delete" shortcut can be used again.
- When using the search functionality in the datasets view, the datasets will be sorted so that the best match is shown first. If a different sorting is desired, the sorting-arrows in the columns can still be used to change the sorting criteria.

### Fixed
- Fix regression affecting node selection, shortcuts and 3d viewport navigation
- Trees in a task will be correctly named again.
- Bug fix: Cell IDs are shown in the segmentation tab for all zoomsteps now
- Fix: Clicking on a project within the task list page was fixed so that the project page will actually only show the linked project.
- Fix: Clicking on a task type within the task list page was fixed so that the task type page will actually only show the linked task type.
- Bug fix for Firefox: A long tree list created an unnecessary scroll region which is resolved now.
- Fixed a bug where the comment tab was scrolled into view horizontally if a node with a comment was activated.
- Fixed an unnecessary warning when deleting a tree in a task, that warned about deleting the initial node although the initial node was not contained in the deleted tree.
- Fix: changing project priotiy should not unpause it
- A bug which caused segmentation data to be requested as four-bit when four-bit-mode was enabled is fixed now.
- Fixed coloring of navbar when logged out

### Removed

## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05

first release
