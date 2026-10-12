//! BloscLZ, the default internal codec of c-blosc (`blosclz.c` of c-blosc 1.21).
//!
//! Stream layout (a FastLZ level-1 dialect):
//! - the first control byte is always a literal run (its upper three bits are ignored);
//! - control `< 32`: literal run of `ctrl + 1` bytes;
//! - control `>= 32`: match. Length nibble `k = ctrl >> 5` gives `k + 2` bytes for `k < 7`, otherwise
//!   `9 + sum(extension bytes)` (extension bytes continue while they are 255). The distance is
//!   `((ctrl & 31) << 8) + code + 1`; `ctrl & 31 == 31 && code == 255` marks a far match whose
//!   distance is `8192 + big-endian u16`.
//!
//! The decoder mirrors c-blosc's bounds checks, including that a match which is the last token of
//! the stream is not copied (the c-blosc encoder always ends with literals).

const MAX_DISTANCE: usize = 8191;
const MAX_FAR_DISTANCE: usize = 65535 + MAX_DISTANCE;
const MAX_COPY: usize = 32;
const HASH_LOG: u32 = 13;

/// Decodes into at most `maxout` bytes. `None` if the stream is malformed or exceeds `maxout`
/// (c-blosc returns 0 in both cases).
pub(crate) fn decompress(input: &[u8], maxout: usize) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::with_capacity(maxout.min(input.len().saturating_mul(16)));
    if input.is_empty() {
        return Some(out);
    }
    let ip_limit = input.len();
    let mut ip = 0usize;
    let mut ctrl = usize::from(input[ip] & 31);
    ip += 1;
    loop {
        if ctrl >= 32 {
            let mut len = (ctrl >> 5) - 1;
            let mut ofs = (ctrl & 31) << 8;
            if len == 7 - 1 {
                loop {
                    if ip + 1 >= ip_limit {
                        return None;
                    }
                    let code = input[ip];
                    ip += 1;
                    len += usize::from(code);
                    if code != 255 {
                        break;
                    }
                }
            } else if ip + 1 >= ip_limit {
                return None;
            }
            let code = usize::from(input[ip]);
            ip += 1;
            len += 3;
            // Distance before c-blosc's final `ref--`.
            let mut back = ofs + code;
            if code == 255 && ofs == (31 << 8) {
                if ip + 1 >= ip_limit {
                    return None;
                }
                ofs = usize::from(input[ip]) << 8;
                ofs += usize::from(input[ip + 1]);
                ip += 2;
                back = ofs + MAX_DISTANCE;
            }
            let distance = back + 1;
            if out.len() + len > maxout {
                return None;
            }
            if distance > out.len() {
                return None;
            }
            if ip >= ip_limit {
                break;
            }
            ctrl = usize::from(input[ip]);
            ip += 1;
            super::lz4::copy_match(&mut out, distance, len);
        } else {
            let run = ctrl + 1;
            if out.len() + run > maxout || ip + run > ip_limit {
                return None;
            }
            out.extend_from_slice(&input[ip..ip + run]);
            ip += run;
            if ip >= ip_limit {
                break;
            }
            ctrl = usize::from(input[ip]);
            ip += 1;
        }
    }
    Some(out)
}

/// Greedy hash-chain-free BloscLZ encoder. Produces streams c-blosc decodes; the byte output is not
/// identical to c-blosc's encoder. Returns `None` if the result would not be smaller than the input
/// (the caller then stores the block uncompressed, like c-blosc).
pub(crate) fn compress(input: &[u8]) -> Option<Vec<u8>> {
    let n = input.len();
    if n < 16 {
        return None;
    }
    let mut out = Vec::with_capacity(n);
    let mut table = vec![usize::MAX; 1 << HASH_LOG];
    let mut literal_start = 0usize;
    let mut ip = 0usize;
    // Keep the tail as literals: the stream must end with a literal run.
    let match_limit = n - 4;
    while ip < match_limit {
        let seq = u32::from_le_bytes([input[ip], input[ip + 1], input[ip + 2], input[ip + 3]]);
        let slot = (seq.wrapping_mul(2_654_435_761) >> (32 - HASH_LOG)) as usize;
        let candidate = table[slot];
        table[slot] = ip;
        if candidate != usize::MAX {
            let distance = ip - candidate;
            if distance <= MAX_FAR_DISTANCE + 1
                && input[candidate..candidate + 3] == input[ip..ip + 3]
            {
                let mut len = 3;
                // Leave at least one trailing literal.
                let max_len = n - 1 - ip;
                while len < max_len && input[candidate + len] == input[ip + len] {
                    len += 1;
                }
                // Far matches need at least 5 bytes to pay off (4-byte token + extension).
                if distance <= MAX_DISTANCE || len >= 5 {
                    emit_literals(&mut out, &input[literal_start..ip]);
                    emit_match(&mut out, distance, len);
                    ip += len;
                    literal_start = ip;
                    if out.len() >= n {
                        return None;
                    }
                    continue;
                }
            }
        }
        ip += 1;
    }
    emit_literals(&mut out, &input[literal_start..]);
    (out.len() < n).then_some(out)
}

fn emit_literals(out: &mut Vec<u8>, literals: &[u8]) {
    for chunk in literals.chunks(MAX_COPY) {
        out.push((chunk.len() - 1) as u8);
        out.extend_from_slice(chunk);
    }
}

fn emit_match(out: &mut Vec<u8>, distance: usize, len: usize) {
    let back = distance - 1;
    let (ofs_hi, code, far) = if back < MAX_DISTANCE {
        ((back >> 8) as u8, (back & 255) as u8, None)
    } else {
        (31u8, 255u8, Some((back - MAX_DISTANCE) as u16))
    };
    if len < 9 {
        out.push((((len - 2) as u8) << 5) | ofs_hi);
    } else {
        out.push((7 << 5) | ofs_hi);
        let mut rest = len - 9;
        while rest >= 255 {
            out.push(255);
            rest -= 255;
        }
        out.push(rest as u8);
    }
    out.push(code);
    if let Some(far) = far {
        out.extend_from_slice(&far.to_be_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_near_far_and_long_matches() {
        let mut data: Vec<u8> = (0..9000u32)
            .map(|i| (i.wrapping_mul(2_654_435_761) >> 24) as u8)
            .collect();
        let head = data.clone();
        data.extend_from_slice(&head); // far matches (distance 9000)
        data.extend(std::iter::repeat_n(7u8, 1000)); // run (distance 1, long length)
        data.extend_from_slice(b"tail");
        let compressed = compress(&data).expect("compressible");
        assert!(compressed.len() < data.len() * 2 / 3);
        assert_eq!(decompress(&compressed, data.len()).unwrap(), data);
        assert_eq!(decompress(&compressed, data.len() - 1), None);
    }

    #[test]
    fn rejects_out_of_range_references() {
        // literal "a", then match with distance 2.
        assert_eq!(decompress(&[0, b'a', 0x20, 1, 0, b'b'], 100), None);
        // literal run longer than the input.
        assert_eq!(decompress(&[5, b'a'], 100), None);
        // valid: literal "a", match distance 1 length 3, literal "b".
        assert_eq!(
            decompress(&[0, b'a', 0x20, 0, 0, b'b'], 100).unwrap(),
            b"aaaab"
        );
        // a match needs its code byte plus a following control byte.
        assert_eq!(decompress(&[0, b'a', 0x20, 0], 100), None);
        // a far match that is the last token is not copied (c-blosc behavior).
        let mut far = vec![31];
        far.extend([b'x'; 32]);
        far.extend([0x3f, 255, 0, 0]);
        assert_eq!(decompress(&far, 100), None); // distance 8192 > 32 bytes of output
        // the control byte after a match must be followed by its literal.
        assert_eq!(decompress(&[0, b'a', 0x20, 0, 0], 100), None);
    }

    #[test]
    fn incompressible_input_is_rejected() {
        let data: Vec<u8> = (0..1000u32)
            .map(|i| (i.wrapping_mul(2_654_435_761).rotate_left(i % 31) >> 13) as u8)
            .collect();
        assert_eq!(compress(&data), None);
        assert_eq!(compress(b"short"), None);
    }
}
