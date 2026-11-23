### Added
- The segment statistics show the sphericity of segments also for layers without a segment statistics file (and for volume annotations), computed from the segment's ad-hoc mesh. A segment index is required.

### Changed
- The surface area of segments is computed natively, without building their meshes, and in double precision.

### Fixed
- Fixed that the surface area of segments computed from their ad-hoc mesh was too small: the faces at the lower borders of the segment's buckets were missing.
