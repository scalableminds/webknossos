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
mod tests;
