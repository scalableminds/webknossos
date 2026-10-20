### Added
- Added support for mesh files of format version 10, which store the meshes in merge-tree order with a row table instead of a hash table. The meshes of an agglomerate of a percentile mapping are found as one run of rows from any of its segments, so loading the precomputed meshes of an agglomerate needs only a few requests, especially from remote storage. Agglomerates of editable mappings based on such a mapping are found from a few runs as well.

### Changed
- Mesh chunk data of Zarr mesh files is read with combined requests for chunks that are close together within a shard. The new datastore config options `datastore.meshFile.maxGapBytes` (`-1` disables combining), `datastore.meshFile.maxRequestBytes` and `datastore.meshFile.maxParallelRequests` control this.
