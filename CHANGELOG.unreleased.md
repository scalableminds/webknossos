# Changelog (Unreleased)

All notable (yet unreleased) user-facing changes to webknossos are documented in this file.
See `CHANGELOG.released.md` for the changes which are part of official releases.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Calendar Versioning](http://calver.org/) `0Y.0M.MICRO`.
For upgrade instructions, please check the [migration guide](MIGRATIONS.released.md).

## Unreleased
[Commits](https://github.com/scalableminds/webknossos/compare/21.06.0...HEAD)

### Added
- Added the possibility for admins to set long-running jobs to a “manually repaired” state. [#5530](https://github.com/scalableminds/webknossos/pull/5530)
- Added compatibility with newer JREs, tested with 8, 11 and 14. [#5558](https://github.com/scalableminds/webknossos/pull/5558)
- The toolbar contains two  additional tools: [#5384](https://github.com/scalableminds/webknossos/pull/5384)
  - one for the skeleton mode (similar to the existing move tool).
  - one for erasing volume data (similar to right-dragging with the previous brush/trace tool)

### Changed
- Improve error logging for unhandled rejections. [#5575](https://github.com/scalableminds/webknossos/pull/5575)
- Improved dragging behavior of trees/groups in the tree tab. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- "Center new Nodes" option was renamed to "Auto-center Nodes" and changed to also influence the centering-behavior when deleting a node. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- The displayed webKnossos version now omits the parent release name for intermediate builds. [#5565](https://github.com/scalableminds/webknossos/pull/5565)
- The following changes belong to [#5384](https://github.com/scalableminds/webknossos/pull/5384):
  - The move tool is only capable of performing movements (its skeleton-functionalities were moved to a dedicated skeleton tool).
  - (Unless classic mode is enabled:) Right-click opens a context-sensitive menu by default with various actions, such as creating an edge between two nodes. Consequently, important actions which were done via right click previously were changed:
      - In the skeleton tool, left click can be used to create, select and move nodes. Also, mere dragging (without hovering a node) moves the active position (similar to the move tool).
      - In the trace/brush tool, erasure cannot be performed with right click, anymore. Instead, CTRL + Shift + Left Click works for erasing. Alternatively, selecting the dedicated erase tool also works.
  - The two tabs in the left sidebar "Annotation" and "Dataset" were renamed and restructured to "Layers" and "Settings".
      - "Layers" contains the layers which were previously visible in "Dataset".
    - Also, "Layers" contains a dedicated Skeleton layer which handles skeleton-specific settings (e.g., clipping distance).
    - "Merger Mode" and "Soma Clicking" were moved to the toolbar (visible when the skeleton tool is selected).
    - “Brush Size” was moved to the toolbar (visible when brush or brush-eraser is selected)
    - "Controls" and "Viewport options" (previously under "Annotation") and "Data Rendering" (previously under "Dataset") were moved to "Settings".
    - The "Bounding Boxes" section in "Annotation" tab was moved to an own tab to the right sidebar.
    - The "Mapping" setting was moved to the segmentation layer in the left sidebar.
  - The status bar contains additional elements for (editable) information, such as the active tree id (previously positioned in the left sidebar).
  - Some UI elements were less spacious by favoring icons instead of labels. Hover these elements to get an helpful tooltip.
- The health check at api/health does not longer include checking data/health and tracings/health if the respective local modules are enabled. Consider monitoring those routes separately. [#5601](https://github.com/scalableminds/webknossos/pull/5601)

### Fixed
- Fixed that a disabled "Center new Nodes" option didn't work correctly in merger mode. [#5538](https://github.com/scalableminds/webknossos/pull/5538)
- Fixed a bug where dataset uploads of zips with just one file inside failed. [#5534](https://github.com/scalableminds/webknossos/pull/5534)
- Fixed a benign error message when a dataset without a segmentation layer was opened in view mode or with a skeleton-only annotation. [#5583](https://github.com/scalableminds/webknossos/pull/5583)
- Fixed crashing tree tab which could happen when dragging a node and then switching directly to another tab (e.g., comments) and then back again. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed that the UI allowed mutating trees in the tree tab (dragging/creating/deleting trees and groups) in read-only tracings. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed "Create a new tree group for this file" setting in front-end import when a group id of 0 was used in the NML. [#5573](https://github.com/scalableminds/webknossos/pull/5573)
- Fixed a bug that caused a distortion when moving or zooming in the maximized 3d viewport. [#5550](https://github.com/scalableminds/webknossos/pull/5550)
- Fixed a bug that prevented focusing the login fields when being prompted to login after trying to view a dataset without being logged in.[#5521](https://github.com/scalableminds/webknossos/pull/5577)
- Fixed that the 3d view content disappeared permanently if the 3d view was resized to not be visible. [#5588](https://github.com/scalableminds/webknossos/pull/5588)
- The following changes belong to [#5384](https://github.com/scalableminds/webknossos/pull/5384):
  - Removed "Highlight hovered cells" setting (highlight on hover will always be done).
  - The "Volume" tab was removed. The "Mapping" setting was moved to the segmentation layer in the left sidebar. The "segment id" table was removed, as the status bar also contains the information about the hovered cell id.

### Removed
-

### Breaking Change
-
