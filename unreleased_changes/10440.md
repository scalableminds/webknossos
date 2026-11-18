### Changed
- The front-end API method `api.data.getMappedDataValue` now also maps the segment id if no agglomerate mapping is applied locally, and no longer throws if no mapping is active.

### Fixed
- Fixed that the voxel pipette showed the unmapped segment id while a mapping was being activated or if the mapping didn't contain the segment yet.
- Fixed that merger mode used agglomerate ids instead of segment ids if an agglomerate mapping was active before merger mode was enabled.
- Fixed that segment ids could be read with an outdated mapping right after a mapping was activated or deactivated (e.g., when loading a precomputed mesh that requires another mapping).
- Fixed that the flood fill tool could compare the active segment id to the wrong segment id if the data at the clicked position wasn't loaded yet.

### Breaking Changes
- The front-end API method `api.data.getDataValue` now returns the segment id as it is rendered, i.e., the mapped id if a mapping is active. Its parameter `respectMapping` is deprecated and ignored. Scripts that need the unmapped segment id (e.g., to build a mapping for `api.data.setMapping`) have to use `api.data.getUnmappedDataValue` instead.
