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
pub(crate) fn decode_block(
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
mod tests {
    use super::*;

    #[test]
    fn decodes_overlapping_matches_and_long_lengths() {
        // 20 literals "a", then a run of 300 more "a" via offset 1.
        let mut block = vec![0xF0 | 0x0F, 5]; // literal len 15+5 = 20, match nibble 15
        block.extend(std::iter::repeat_n(b'a', 20));
        block.extend([1, 0]); // offset 1
        block.extend([255, 26]); // match len 15 + 255 + 26 + 4 = 300
        block.push(0x10); // final token: 1 literal
        block.push(b'b');
        let (out, consumed) = decode_block(&block, 1000, Lz4End::InputExhausted).unwrap();
        assert_eq!(consumed, block.len());
        assert_eq!(out.len(), 321);
        assert!(out[..320].iter().all(|&b| b == b'a'));
        assert_eq!(out[320], b'b');
        assert_eq!(
            decode_block(&block, 320, Lz4End::InputExhausted),
            Err(Lz4Error::TooLarge)
        );
    }

    #[test]
    fn rejects_bad_offsets_and_truncation() {
        assert!(matches!(
            decode_block(&[0x10, b'a', 2, 0], 100, Lz4End::InputExhausted),
            Err(Lz4Error::Malformed(_))
        ));
        assert!(matches!(
            decode_block(&[0x10, b'a', 0, 0], 100, Lz4End::InputExhausted),
            Err(Lz4Error::Malformed(_))
        ));
        assert!(matches!(
            decode_block(&[0x10, b'a', 1], 100, Lz4End::InputExhausted),
            Err(Lz4Error::Malformed(_))
        ));
        assert!(matches!(
            decode_block(&[0x50, b'a'], 100, Lz4End::InputExhausted),
            Err(Lz4Error::Malformed(_))
        ));
        assert!(matches!(
            decode_block(&[0xF0], 100, Lz4End::InputExhausted),
            Err(Lz4Error::Malformed(_))
        ));
    }

    #[test]
    fn round_trips_with_lz4_flex() {
        let data: Vec<u8> = (0..10_000u32).map(|i| (i / 7 % 13) as u8).collect();
        let compressed = compress_block(&data);
        assert!(compressed.len() < data.len());
        let (out, consumed) = decode_block(&compressed, data.len(), Lz4End::OutputFull).unwrap();
        assert_eq!(out, data);
        assert_eq!(consumed, compressed.len());
        let (out, _) = decode_block(&compressed, usize::MAX, Lz4End::InputExhausted).unwrap();
        assert_eq!(out, data);
        assert_eq!(
            decode_block(&compress_block(&[]), 0, Lz4End::OutputFull),
            Ok((Vec::new(), 1))
        );
    }
}
