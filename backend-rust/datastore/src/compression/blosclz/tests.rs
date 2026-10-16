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
