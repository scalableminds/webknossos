//! Fixed-size reads from the start of byte slices (binary headers, indices, CBOR).
//!
//! All readers panic when the slice is shorter than the value: callers take them from a slice
//! whose length they already checked (`get(range)?`, a length-validated buffer, a digest).

/// The first `N` bytes of `bytes` as an array.
///
/// # Panics
/// If `bytes` is shorter than `N`.
#[must_use]
pub fn array<const N: usize>(bytes: &[u8]) -> [u8; N] {
    *bytes
        .first_chunk()
        .expect("byte slice shorter than the value read from it")
}

macro_rules! readers {
    ($($name:ident: $ty:ty, $from:ident;)*) => {$(
        #[doc = concat!("`", stringify!($ty), "::", stringify!($from), "` of the first bytes.")]
        ///
        /// # Panics
        /// If `bytes` is shorter than the value.
        #[must_use]
        pub fn $name(bytes: &[u8]) -> $ty {
            <$ty>::$from(array(bytes))
        }
    )*};
}

readers! {
    u16_le: u16, from_le_bytes;
    i16_le: i16, from_le_bytes;
    u32_le: u32, from_le_bytes;
    i32_le: i32, from_le_bytes;
    u64_le: u64, from_le_bytes;
    i64_le: i64, from_le_bytes;
    f32_le: f32, from_le_bytes;
    f64_le: f64, from_le_bytes;
    u16_be: u16, from_be_bytes;
    i16_be: i16, from_be_bytes;
    u32_be: u32, from_be_bytes;
    i32_be: i32, from_be_bytes;
    u64_be: u64, from_be_bytes;
}

#[cfg(test)]
mod tests;
