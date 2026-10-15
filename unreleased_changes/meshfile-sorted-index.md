### Added
- Added support for mesh files of format version 10, which look up segments in an index sorted by segment id instead of a hash table. Loading the precomputed meshes of an agglomerate from such a mesh file needs far fewer requests, especially from remote storage.

### Changed
- Mesh chunk data of Zarr mesh files is read with combined requests for chunks that are close together within a shard. The new datastore config options `datastore.meshFile.maxGapBytes` (`-1` disables combining), `datastore.meshFile.maxRequestBytes` and `datastore.meshFile.maxParallelRequests` control this.
