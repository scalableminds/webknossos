//! c-blosc 1.21.6 (the version bundled by blosc-java `0.3-1.21.6`, which the Scala datastore uses),
//! statically linked through `blosc-src`.
//!
//! Both functions mirror blosc-java's JNI functions `_compress` and `_decompress`: the same c-blosc
//! calls with the same arguments and the same error texts. They use the `_ctx` variants, which
//! keep no global state and are safe to call from several threads at once.

use std::ffi::{CString, c_int, c_void};

use blosc_src::{blosc_cbuffer_validate, blosc_compress_ctx, blosc_decompress_ctx};

/// Extra bytes c-blosc may need beyond the input size (`BLOSC_MAX_OVERHEAD`).
const MAX_OVERHEAD: usize = blosc_src::BLOSC_MAX_OVERHEAD as usize;

/// `blosc_compress_ctx` with blosc-java's output buffer of `input.len() + BLOSC_MAX_OVERHEAD`.
/// `compressor` is a c-blosc compressor name (`blosclz`, `lz4`, `lz4hc`, `zlib`, `zstd`), `shuffle`
/// one of `BLOSC_NOSHUFFLE`/`BLOSC_SHUFFLE`/`BLOSC_BITSHUFFLE`.
pub fn compress(
    input: &[u8],
    clevel: i32,
    shuffle: i32,
    typesize: usize,
    compressor: &str,
    blocksize: usize,
    num_threads: i32,
) -> Result<Vec<u8>, String> {
    let compressor = CString::new(compressor).map_err(|_| "Error while compressing buffer")?;
    let capacity = input.len() + MAX_OVERHEAD;
    let mut out = Vec::<u8>::with_capacity(capacity);
    // SAFETY: `input` is readable for `input.len()` bytes, `out` writable for `capacity` bytes, and
    // c-blosc writes at most `destsize` bytes. `compressor` is NUL-terminated and outlives the call.
    let written = unsafe {
        blosc_compress_ctx(
            c_int::from(clevel),
            c_int::from(shuffle),
            typesize,
            input.len(),
            input.as_ptr().cast::<c_void>(),
            out.as_mut_ptr().cast::<c_void>(),
            capacity,
            compressor.as_ptr(),
            blocksize,
            c_int::from(num_threads),
        )
    };
    let written = usize::try_from(written)
        .ok()
        .filter(|&n| n > 0 && n <= capacity)
        .ok_or("Error while compressing buffer")?;
    // SAFETY: c-blosc initialized the first `written` bytes (checked to be within the capacity).
    unsafe { out.set_len(written) };
    Ok(out)
}

/// `blosc_cbuffer_validate` against the whole input (so trailing bytes after the header's `cbytes`
/// are rejected, as in blosc-java), then `blosc_decompress_ctx` into a buffer of the header's
/// `nbytes`. The caller bounds `nbytes` before calling this.
pub fn decompress(input: &[u8], num_threads: i32) -> Result<Vec<u8>, String> {
    let mut nbytes = 0usize;
    // SAFETY: `input` is readable for `input.len()` bytes; c-blosc reads only the 16-byte header
    // and returns an error for shorter inputs before reading it.
    let valid = unsafe {
        blosc_cbuffer_validate(
            input.as_ptr().cast::<c_void>(),
            input.len(),
            &raw mut nbytes,
        )
    };
    if valid < 0 {
        return Err("Buffer does not contain valid blosc-encoded contents".to_owned());
    }
    let mut out = Vec::<u8>::with_capacity(nbytes);
    // SAFETY: the header's `cbytes` equals `input.len()` (validated above), so c-blosc reads within
    // `input`; it writes at most `destsize` = `nbytes` bytes into `out`, which has that capacity.
    let written = unsafe {
        blosc_decompress_ctx(
            input.as_ptr().cast::<c_void>(),
            out.as_mut_ptr().cast::<c_void>(),
            nbytes,
            c_int::from(num_threads),
        )
    };
    let written = usize::try_from(written)
        .ok()
        .filter(|&n| n <= nbytes)
        .ok_or("Error while decompressing buffer")?;
    // SAFETY: c-blosc initialized the first `written` bytes (checked to be within the capacity).
    unsafe { out.set_len(written) };
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_compressor() {
        let input: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        for compressor in ["blosclz", "lz4", "lz4hc", "zlib", "zstd"] {
            let compressed = compress(&input, 5, 1, 4, compressor, 0, 1).unwrap();
            assert!(compressed.len() < input.len(), "{compressor}");
            assert_eq!(decompress(&compressed, 1).unwrap(), input, "{compressor}");
        }
    }

    #[test]
    fn rejects_invalid_buffers() {
        let compressed = compress(&[7u8; 1000], 5, 1, 1, "lz4", 0, 1).unwrap();
        let mut trailing = compressed.clone();
        trailing.push(0);
        for bad in [
            &compressed[..10],
            &compressed[..compressed.len() - 1],
            &trailing,
        ] {
            assert_eq!(
                decompress(bad, 1).unwrap_err(),
                "Buffer does not contain valid blosc-encoded contents"
            );
        }
        assert_eq!(
            compress(&[1, 2, 3], 5, 1, 1, "snappy", 0, 1).unwrap_err(),
            "Error while compressing buffer"
        );
    }
}
