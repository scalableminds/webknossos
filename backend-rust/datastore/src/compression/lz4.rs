//! Raw LZ4 block format (no frame, no size prefix), as written by lz4-java's block compressors
//! and Apache commons-compress `BlockLZ4CompressorOutputStream`, decoded and encoded by
//! `lz4_flex`.
//!
//! Decoding is bounded: the output buffer is sized from the block's sequence headers (or the
//! caller's exact size) and never exceeds `limit`; no size information from the input is trusted.

/// Why a raw LZ4 block could not be decoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Lz4Error {
    /// The block is not a valid LZ4 block of the expected size.
    Malformed(String),
    /// The output would exceed the allowed number of bytes.
    TooLarge,
}

impl std::fmt::Display for Lz4Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(reason) => write!(f, "malformed LZ4 block: {reason}"),
            Self::TooLarge => f.write_str("LZ4 block decompresses to more bytes than allowed"),
        }
    }
}

fn malformed(reason: impl Into<String>) -> Lz4Error {
    Lz4Error::Malformed(reason.into())
}

/// Decodes a whole raw LZ4 block of at most `limit` output bytes (commons-compress
/// `BlockLZ4CompressorInputStream`, liblz4 `LZ4_decompress_safe`).
pub(crate) fn decompress(input: &[u8], limit: usize) -> Result<Vec<u8>, Lz4Error> {
    let size = decoded_len(input).ok_or_else(|| malformed("truncated sequence"))?;
    if size > limit {
        return Err(Lz4Error::TooLarge);
    }
    decompress_exact(input, size)
}

/// Decodes a whole raw LZ4 block that must produce exactly `size` bytes (lz4-java
/// `fastDecompressor` as used for WKW blocks, which also requires the whole input to be consumed).
pub(crate) fn decompress_exact(input: &[u8], size: usize) -> Result<Vec<u8>, Lz4Error> {
    let mut out = vec![0; size];
    let written =
        lz4_flex::block::decompress_into(input, &mut out).map_err(|e| malformed(e.to_string()))?;
    if written != size {
        return Err(malformed(format!(
            "expected {size} decompressed bytes, got {written}"
        )));
    }
    Ok(out)
}

/// Output length of a block, summed from its sequence headers (literals are skipped, offsets are
/// not checked). `None` if the headers run past the input.
fn decoded_len(input: &[u8]) -> Option<usize> {
    let mut ip = 0usize;
    let mut total = 0usize;
    while ip < input.len() {
        let token = input[ip];
        ip += 1;
        let literal_len = read_length(input, &mut ip, usize::from(token >> 4))?;
        ip = ip.checked_add(literal_len)?;
        total = total.checked_add(literal_len)?;
        if ip >= input.len() {
            return (ip == input.len()).then_some(total);
        }
        ip += 2;
        let match_len = read_length(input, &mut ip, usize::from(token & 0x0f))? + 4;
        total = total.checked_add(match_len)?;
    }
    Some(total)
}

fn read_length(input: &[u8], ip: &mut usize, nibble: usize) -> Option<usize> {
    let mut len = nibble;
    if nibble == 15 {
        loop {
            let byte = *input.get(*ip)?;
            *ip += 1;
            len = len.checked_add(usize::from(byte))?;
            if byte != 255 {
                break;
            }
        }
    }
    Some(len)
}

/// Raw LZ4 block compression (valid input for every LZ4 block decoder).
pub(crate) fn compress_block(input: &[u8]) -> Vec<u8> {
    lz4_flex::block::compress(input)
}

#[cfg(test)]
mod compression_lz4_tests;
