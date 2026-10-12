//! Zarr v2 (Scala `datareaders/zarr`): `.zarray` header, array opening and OME-NGFF metadata.

mod array;
mod header;
pub mod ngff;

pub use array::{open_zarr_array, parse_zarr_header};
pub use header::{FILENAME_DOT_ZARRAY, ZarrHeader, resolve_zarr2_data_type};
