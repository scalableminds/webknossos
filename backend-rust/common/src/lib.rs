//! Code shared by the Rust backend and datastore, like Scala's `util` project and the datastore
//! models the Scala backend imports directly.

pub mod bytes;
pub mod datasource;
pub mod enums;
pub mod explore_layers;
pub mod geometry;
pub mod java_format;
pub mod json;
pub mod math;
pub mod proto;
pub mod source_paths;
pub mod text;
pub mod upath;

// Paths for the exported macros, so expansions don't depend on the caller's dependencies.
#[doc(hidden)]
pub use serde as __serde;
#[doc(hidden)]
pub use serde_json as __serde_json;
