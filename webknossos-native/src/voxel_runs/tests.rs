use super::*;

fn varint(mut value: usize) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        if value < 0x80 {
            out.push(value as u8);
            return out;
        }
        out.push((value & 0x7f) as u8 | 0x80);
        value >>= 7;
    }
}

fn header(format_version: u8, run_axis: u8, value: u64) -> Vec<u8> {
    let mut out = vec![format_version, run_axis];
    out.extend_from_slice(&value.to_le_bytes());
    out
}

fn encode(run_axis: u8, value: u64, runs: &[(usize, usize)]) -> Vec<u8> {
    let mut out = header(1, run_axis, value);
    out.extend(varint(runs.len()));
    for &(gap, length) in runs {
        out.extend(varint(gap));
        out.extend(varint(length));
    }
    out
}

/// The bucket index (x fastest) of a linear index in the run order of `run_axis`.
fn bucket_index(run_axis: u8, linear: usize) -> usize {
    let (a, b, c) = (
        linear % BUCKET_WIDTH,
        (linear / BUCKET_WIDTH) % BUCKET_WIDTH,
        linear / (BUCKET_WIDTH * BUCKET_WIDTH),
    );
    let (x, y, z) = match run_axis {
        0 => (a, b, c),
        1 => (c, a, b),
        _ => (b, c, a),
    };
    x + BUCKET_WIDTH * (y + BUCKET_WIDTH * z)
}

/// Writes runs one voxel at a time, as a reference for the optimized writers.
fn write_naive<T: Element>(run_axis: u8, value: u64, runs: &[(usize, usize)], bucket: &mut [u8]) {
    let mut linear = 0;
    for &(gap, length) in runs {
        linear += gap;
        for l in linear..linear + length {
            let index = bucket_index(run_axis, l) * T::SIZE;
            T::write(&mut bucket[index..index + T::SIZE], value as i64);
        }
        linear += length;
    }
}

/// Random non-overlapping runs within one bucket (xorshift, no dependencies).
fn random_runs(seed: u64, count: usize, max_gap: usize, max_length: usize) -> Vec<(usize, usize)> {
    let mut state = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
    let mut next = move |bound: usize| {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state % bound as u64) as usize
    };
    let mut end = 0;
    let mut runs = Vec::new();
    for _ in 0..count {
        let gap = next(max_gap);
        let length = 1 + next(max_length);
        if end + gap + length <= BUCKET_VOXEL_COUNT {
            end += gap + length;
            runs.push((gap, length));
        }
    }
    runs
}

fn check_matches_naive<T: Element>(run_axis: u8, value: u64, runs: &[(usize, usize)]) {
    let initial: Vec<u8> = (0..BUCKET_VOXEL_COUNT * T::SIZE)
        .map(|i| (i * 7 % 251) as u8)
        .collect();
    let buffer = encode(run_axis, value, runs);
    let header = validate(&buffer).unwrap();
    let mut actual = initial.clone();
    write::<T>(&buffer, &header, &mut actual);
    let mut expected = initial;
    write_naive::<T>(run_axis, value, runs, &mut expected);
    assert!(actual == expected, "axis {run_axis}, size {}", T::SIZE);
}

#[test]
fn all_run_orders_match_a_voxel_by_voxel_reference() {
    let full = [(0, BUCKET_VOXEL_COUNT)];
    for run_axis in 0..3 {
        for seed in 0..4 {
            let short = random_runs(seed * 3 + run_axis as u64, 400, 100, 40);
            let long = random_runs(seed * 3 + run_axis as u64 + 100, 30, 300, 3000);
            for runs in [&short[..], &long[..], &full[..], &[]] {
                check_matches_naive::<u8>(run_axis, 0xab, runs);
                check_matches_naive::<u16>(run_axis, 0x1234, runs);
                check_matches_naive::<u32>(run_axis, u64::MAX, runs);
                check_matches_naive::<u64>(run_axis, 0x0102_0304_0506_0708, runs);
            }
        }
    }
}

#[test]
fn transpose32_transposes() {
    let mut rows = [0u32; 32];
    for (r, row) in rows.iter_mut().enumerate() {
        *row = (r as u32).wrapping_mul(0x9e37_79b9) ^ 0x5555_aaaa;
    }
    let original = rows;
    transpose32(&mut rows);
    for (r, original_row) in original.iter().enumerate() {
        for (c, row) in rows.iter().enumerate() {
            assert_eq!((row >> r) & 1, (original_row >> c) & 1);
        }
    }
}

#[test]
fn validates_the_buffer() {
    let valid = encode(0, 5, &[(10, 20), (5, 5)]);
    let parsed = validate(&valid).unwrap();
    assert_eq!(parsed.run_axis, 0);
    assert_eq!(parsed.value, 5);
    assert_eq!(parsed.run_count, 2);
    assert_eq!(parsed.runs_offset, 11);

    let with = |tail: &[u8]| [header(1, 0, 5), tail.to_vec()].concat();
    let invalid: Vec<Vec<u8>> = vec![
        vec![],
        valid[..9].to_vec(),
        [header(2, 0, 5), varint(0)].concat(),
        [header(1, 3, 5), varint(0)].concat(),
        header(1, 0, 5),
        [header(1, 0, 5), varint(BUCKET_VOXEL_COUNT + 1)].concat(),
        encode(1, 5, &[(BUCKET_VOXEL_COUNT - 10, 11)]),
        valid[..valid.len() - 1].to_vec(),
        [valid.clone(), vec![0]].concat(),
        with(&[1, 0x80]),
        with(&[1, 0x80, 0x80, 0x80, 1, 1]),
    ];
    for buffer in invalid {
        assert!(validate(&buffer).is_err(), "{buffer:?}");
    }
    assert!(validate(&encode(2, 5, &[(BUCKET_VOXEL_COUNT - 10, 10)])).is_ok());
    assert!(validate(&encode(2, 5, &[(0, 0), (0, 0)])).is_ok());
}
