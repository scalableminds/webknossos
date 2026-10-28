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

/// The lz4_flex fast path must return exactly what the reference decoder returns: valid blocks,
/// byte mutations of them, truncations and trailing bytes, for both stopping rules and for limits
/// below, at and above the decoded size.
#[test]
fn fast_path_matches_reference_decoder() {
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    let mut next = move || {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) as usize
    };
    for case in 0..400 {
        let len = next() % 5000;
        let alphabet = 1 + next() % 8;
        let data: Vec<u8> = (0..len).map(|_| (next() % alphabet) as u8).collect();
        let block = compress_block(&data);
        let mut variants = vec![block.clone()];
        for _ in 0..8 {
            let mut mutated = block.clone();
            let i = next() % mutated.len();
            mutated[i] = next() as u8;
            variants.push(mutated);
        }
        variants.push(block[..next() % block.len()].to_vec());
        let mut trailing = block.clone();
        trailing.extend((0..1 + next() % 4).map(|_| next() as u8));
        variants.push(trailing);
        for input in &variants {
            for limit in [len.saturating_sub(1), len, len + 7] {
                for end in [Lz4End::InputExhausted, Lz4End::OutputFull] {
                    assert_eq!(
                        decode_block(input, limit, end),
                        decode_block_reference(input, limit, end),
                        "case {case}, limit {limit}, {end:?}"
                    );
                }
            }
        }
    }
}
