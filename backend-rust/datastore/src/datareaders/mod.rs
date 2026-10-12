//! Chunked n-d array readers (Scala `datastore/datareaders`): the format-independent
//! `DatasetArray` core plus Zarr v2 and OME-NGFF metadata. WKW, Zarr v3, N5 and Neuroglancer
//! precomputed plug in through [`DatasetHeader`] and [`ArrayFormat`].
//! See ../../../checkpoints/datastore-ds2-core.md for the API contract and deviations.

pub mod axis_order;
pub mod bucket_provider;
pub mod cache;
pub mod chunk;
pub mod chunk_utils;
pub mod data_type;
pub mod dataset_array;
pub mod hdf5;
pub mod header;
pub(crate) mod index_cache;
pub mod n5;
pub mod nd_array;
pub mod precomputed;
pub mod wkw;
pub mod zarr;
pub mod zarr3;

pub use axis_order::FullAxisOrder;
pub use cache::ChunkContentsCache;
pub use chunk::{
    ArrayFormat, ChunkBytesAndShape, ChunkContents, DefaultArrayFormat,
    default_read_chunk_bytes_and_shape, read_chunk,
};
pub use chunk_utils::compute_chunk_indices;
pub use data_type::{
    ArrayDataType, ArrayOrder, ByteOrder, DimensionSeparator, FillValue, JavaNumber,
};
pub use dataset_array::{
    CHUNK_SIZE_LIMIT_BYTES, DatasetArray, RequestedAdditionalCoordinate, assert_chunk_size_limit,
};
pub use header::DatasetHeader;
pub use nd_array::{MaDataType, NdArray};
