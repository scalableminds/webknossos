### Fixed
- Fixed that Zarr streaming of volume annotations with additional axes (e.g. a `t` axis inherited from the dataset) returned only zeros, because `.zarray` and `datasource-properties.json` omitted the additional axes. Also fixed that the zarr.json of layers and annotations with additional axes reported a size one too small along those axes.
