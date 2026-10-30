//! Raw LZ4 block format (no frame, no size prefix), as written by lz4-java's block compressors
//! and Apache commons-compress `BlockLZ4CompressorOutputStream`.
//!
//! The decoder is bounded: it never produces more than `limit` bytes and never trusts any size
//! information from the input.

/// Why a raw LZ4 block could not be decoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Lz4Error {
    /// The block references data before the start of the output or ends in the middle of a
    /// sequence.
    Malformed(&'static str),
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

/// How decoding ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Lz4End {
    /// Decode sequences until the input is exhausted (commons-compress `BlockLZ4CompressorInputStream`,
    /// liblz4 `LZ4_decompress_safe`).
    InputExhausted,
    /// Stop as soon as exactly `limit` bytes were produced (lz4-java `fastDecompressor`). The caller
    /// gets the number of consumed input bytes back.
    OutputFull,
}

/// Decodes a raw LZ4 block. Returns the output and the number of consumed input bytes.
///
/// Well-formed blocks are decoded by `lz4_flex` into a buffer of the exact output size (`limit`
/// for [`Lz4End::OutputFull`], the length summed from the sequence headers otherwise). Whatever it
/// rejects, and an `OutputFull` block that ends early, is decoded again by
/// [`decode_block_reference`], so errors and partially consumed inputs stay those of the Java
/// decoders.
pub(crate) fn decode_block(
    input: &[u8],
    limit: usize,
    end: Lz4End,
) -> Result<(Vec<u8>, usize), Lz4Error> {
    let size = match end {
        Lz4End::OutputFull => Some(limit),
        Lz4End::InputExhausted => decoded_len(input).filter(|&n| n <= limit),
    };
    if let Some(size) = size {
        let mut out = vec![0; size];
        // On success lz4_flex has consumed the whole input.
        if matches!(lz4_flex::block::decompress_into(input, &mut out), Ok(n) if n == size) {
            return Ok((out, input.len()));
        }
    }
    decode_block_reference(input, limit, end)
}

/// Output length of a block, summed from its sequence headers (literals are skipped, offsets are
/// not checked). `None` if the headers run past the input.
fn decoded_len(input: &[u8]) -> Option<usize> {
    let mut ip = 0usize;
    let mut total = 0usize;
    while ip < input.len() {
        let token = input[ip];
        ip += 1;
        let literal_len = read_length(input, &mut ip, usize::from(token >> 4)).ok()?;
        ip = ip.checked_add(literal_len)?;
        total = total.checked_add(literal_len)?;
        if ip >= input.len() {
            return (ip == input.len()).then_some(total);
        }
        ip += 2;
        let match_len = read_length(input, &mut ip, usize::from(token & 0x0f)).ok()? + 4;
        total = total.checked_add(match_len)?;
    }
    Some(total)
}

/// The bounded byte-wise decoder behind [`decode_block`]; it mirrors the Java decoders' checks and
/// stopping rules.
pub(crate) fn decode_block_reference(
    input: &[u8],
    limit: usize,
    end: Lz4End,
) -> Result<(Vec<u8>, usize), Lz4Error> {
    let mut out: Vec<u8> = Vec::with_capacity(input.len().saturating_mul(3).min(limit));
    let mut ip = 0usize;
    if end == Lz4End::OutputFull && limit == 0 {
        // lz4-java reads the single token of an empty block.
        return if input.first() == Some(&0) {
            Ok((out, 1))
        } else {
            Err(Lz4Error::Malformed("unexpected data for an empty block"))
        };
    }
    while ip < input.len() {
        let token = input[ip];
        ip += 1;
        let literal_len = read_length(input, &mut ip, usize::from(token >> 4))?;
        let literal_end = ip
            .checked_add(literal_len)
            .filter(|&e| e <= input.len())
            .ok_or(Lz4Error::Malformed("literals exceed the input"))?;
        if out.len() + literal_len > limit {
            return Err(Lz4Error::TooLarge);
        }
        out.extend_from_slice(&input[ip..literal_end]);
        ip = literal_end;
        if end == Lz4End::OutputFull && out.len() == limit {
            return Ok((out, ip));
        }
        if ip == input.len() {
            break;
        }
        if ip + 2 > input.len() {
            return Err(Lz4Error::Malformed("truncated match offset"));
        }
        let offset = usize::from(u16::from_le_bytes([input[ip], input[ip + 1]]));
        ip += 2;
        if offset == 0 || offset > out.len() {
            return Err(Lz4Error::Malformed("match offset out of range"));
        }
        let match_len = read_length(input, &mut ip, usize::from(token & 0x0f))? + 4;
        if out.len() + match_len > limit {
            return Err(Lz4Error::TooLarge);
        }
        copy_match(&mut out, offset, match_len);
    }
    if end == Lz4End::OutputFull {
        return Err(Lz4Error::Malformed(
            "block ends before the expected output size",
        ));
    }
    Ok((out, ip))
}

fn read_length(input: &[u8], ip: &mut usize, nibble: usize) -> Result<usize, Lz4Error> {
    let mut len = nibble;
    if nibble == 15 {
        loop {
            let byte = *input
                .get(*ip)
                .ok_or(Lz4Error::Malformed("truncated length"))?;
            *ip += 1;
            len = len
                .checked_add(usize::from(byte))
                .ok_or(Lz4Error::Malformed("length overflow"))?;
            if byte != 255 {
                break;
            }
        }
    }
    Ok(len)
}

/// Appends `len` bytes starting `offset` bytes back; overlapping copies repeat the pattern.
pub(crate) fn copy_match(out: &mut Vec<u8>, offset: usize, len: usize) {
    let start = out.len() - offset;
    if offset >= len {
        out.extend_from_within(start..start + len);
    } else {
        out.reserve(len);
        for i in 0..len {
            let byte = out[start + i];
            out.push(byte);
        }
    }
}

/// Raw LZ4 block compression (valid input for every LZ4 block decoder).
pub(crate) fn compress_block(input: &[u8]) -> Vec<u8> {
    lz4_flex::block::compress(input)
}

#[cfg(test)]
mod compression_lz4_tests;
