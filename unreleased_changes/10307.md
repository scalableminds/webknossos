### Added
- Added support for mesh files of format version 10, which store the meshes in merge-tree order with a row table instead of a hash table. The meshes of an agglomerate of a percentile mapping are found as one run of rows from any of its segments, so loading the precomputed meshes of an agglomerate needs only a few requests, especially from remote storage. Agglomerates of editable mappings based on such a mapping are found from a few runs as well.

### Changed
- The mesh chunk data of a request to a Zarr mesh file is read in parallel instead of one range after another.
