# Changelog
All notable user-facing changes to webknossos are documented in this file.

This project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.md).

## [Unreleased]
[Commits](https://github.com/scalableminds/webknossos/compare/18.07.0...HEAD)

- logo which is displayed next to tracing view is now configurable
- Task search, when filtered by user, now shows all (except cancelled) instead of just active tasks
- Improve loading speed of buckets
- Bug fix for Firefox: A long tree list created an unnecessary scroll region which is resolved now.
- When getting a new task, the new description is shown in a modal which can only be closed after ten seconds. These ten seconds should be used to fully understand the new task type.
- Fixed a bug where the comment tab was scrolled into view horizontally if a node with a comment was activated.
- Fixed an unnecessary warning when deleting a tree in a task, that warned about deleting the initial node although the initial node was not contained in the deleted tree.
- Fix: changing project priotiy should not unpause it
- It is now possible again to kick a user out of the organization team
- When deleting the last node of a tree, that tree will not be removed automatically anymore. Instead, the tree will just be empty. To remove that active tree, the "delete" shortcut can be used again.
- Performance improvements for orthogonal mode.
- A bug which caused segmentation data to be requested as four-bit when four-bit-mode was enabled is fixed now.
- When using the search functionality in the datasets view, the datasets will be sorted so that the best match is shown first. If a different sorting is desired, the sorting-arrows in the columns can still be used to change the sorting criteria.
- Webknossos renders Markdown in View mode
- Fixed coloring of navbar when logged out

## [18.07.0](https://github.com/scalableminds/webknossos/releases/tag/18.07.0) - 2018-07-05

first release
