//! Scala `dataformats/wkw/MortonEncoding`.

/// Scala `MortonEncoding.mortonEncode`: interleaves the bits of `x`, `y`, `z` (x lowest). The bit
/// count is computed like Scala (`ceil(log(max + 1) / log(2))`) and shifts use Java `int`
/// semantics (shift distance masked to 5 bits, wrapping), so negative or huge inputs produce the
/// same (meaningless) value as Scala.
pub fn morton_encode(x: i32, y: i32, z: i32) -> i32 {
    let max = x.max(y).max(z);
    let bit_length = ((f64::from(max) + 1.0).ln() / 2f64.ln()).ceil();
    // Java `Double.toInt`: NaN -> 0, saturating otherwise.
    let bit_length = bit_length as i32;
    let mut morton = 0i32;
    for i in 0..bit_length.max(0) {
        let i = i as u32;
        let bit = |v: i32| v & 1i32.wrapping_shl(i);
        morton |= bit(x).wrapping_shl(2 * i)
            | bit(y).wrapping_shl(2 * i + 1)
            | bit(z).wrapping_shl(2 * i + 2);
    }
    morton
}

#[cfg(test)]
mod tests {
    use super::morton_encode;

    fn reference(x: u32, y: u32, z: u32) -> u32 {
        (0..10).fold(0, |acc, i| {
            acc | ((x >> i) & 1) << (3 * i)
                | ((y >> i) & 1) << (3 * i + 1)
                | ((z >> i) & 1) << (3 * i + 2)
        })
    }

    #[test]
    fn interleaves_bits_like_scala() {
        assert_eq!(morton_encode(0, 0, 0), 0);
        assert_eq!(morton_encode(1, 0, 0), 1);
        assert_eq!(morton_encode(0, 1, 0), 2);
        assert_eq!(morton_encode(0, 0, 1), 4);
        assert_eq!(morton_encode(1, 1, 1), 7);
        assert_eq!(morton_encode(2, 0, 0), 8);
        assert_eq!(morton_encode(3, 5, 6), 0b110_101_011);
        for x in [0u32, 1, 7, 8, 31, 32, 100, 511, 1023] {
            for y in [0u32, 3, 16, 255, 1000] {
                for z in [0u32, 2, 63, 64, 777, 1023] {
                    assert_eq!(
                        morton_encode(x as i32, y as i32, z as i32) as u32,
                        reference(x, y, z),
                        "{x} {y} {z}"
                    );
                }
            }
        }
        // a full 32^3 file maps bijectively onto [0, 32768)
        let mut seen = vec![false; 32 * 32 * 32];
        for x in 0..32 {
            for y in 0..32 {
                for z in 0..32 {
                    let m = morton_encode(x, y, z) as usize;
                    assert!(!seen[m]);
                    seen[m] = true;
                }
            }
        }
    }
}
