use super::*;

fn bucket<T: Element>(values: &[i64]) -> Vec<u8> {
    let mut bytes = vec![0u8; values.len() * T::SIZE];
    for (chunk, &value) in bytes.chunks_exact_mut(T::SIZE).zip(values) {
        T::write(chunk, value);
    }
    bytes
}

#[test]
fn element_count_validates_the_element_size() {
    assert_eq!(element_count(64, 8).unwrap(), 8);
    assert!(element_count(64, 0).is_err());
    assert!(element_count(64, -1).is_err());
    assert!(element_count(63, 2).is_err());
}

#[test]
fn elements_are_sign_or_zero_extended() {
    assert_eq!(u8::read(&[0xff]), 255);
    assert_eq!(i8::read(&[0xff]), -1);
    assert_eq!(u16::read(&[0x00, 0x80]), 32768);
    assert_eq!(i16::read(&[0x00, 0x80]), -32768);
    assert_eq!(u64::read(&[0xff; 8]), -1);
}

#[test]
fn counts_segment_voxels_for_all_element_types() {
    let values = [0, 5, 5, 255, 5, 0];
    assert_eq!(
        count_segment_voxels(&bucket::<u8>(&values), 1, false, 5).unwrap(),
        3
    );
    assert_eq!(
        count_segment_voxels(&bucket::<u8>(&values), 1, false, 255).unwrap(),
        1
    );
    assert_eq!(
        count_segment_voxels(&bucket::<u8>(&values), 1, true, 255).unwrap(),
        0
    );
    assert_eq!(
        count_segment_voxels(&bucket::<u8>(&values), 1, true, -1).unwrap(),
        1
    );
    assert_eq!(
        count_segment_voxels(&bucket::<u32>(&values), 4, false, 0).unwrap(),
        2
    );
    assert_eq!(
        count_segment_voxels(&bucket::<u64>(&[-1, -1]), 8, false, -1).unwrap(),
        2
    );
}

#[test]
fn rejects_unsupported_element_sizes_unless_the_bucket_is_empty() {
    assert!(count_segment_voxels(&[0u8; 6], 3, false, 0).is_err());
    assert_eq!(count_segment_voxels(&[], 3, false, 0).unwrap(), 0);
}

#[test]
fn collects_distinct_segment_ids() {
    let values = [0, 5, 5, 255, 5, 0, 7, 7];
    let mut ids = collect_segment_ids(&bucket::<u8>(&values), 1, false, false).unwrap();
    ids.sort();
    assert_eq!(ids, vec![0, 5, 7, 255]);
    let mut ids = collect_segment_ids(&bucket::<i8>(&values), 1, true, true).unwrap();
    ids.sort();
    assert_eq!(ids, vec![-1, 5, 7]);
    assert!(collect_segment_ids(&[], 3, false, false).is_err());
    assert!(collect_segment_ids(&[0u8; 3], 2, false, false).is_err());
    assert!(
        collect_segment_ids(&bucket::<u64>(&[]), 8, false, false)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn extends_the_bounding_box() {
    let length = 4;
    let mut values = vec![0i64; length * length * length];
    let index = |x: usize, y: usize, z: usize| x + length * (y + length * z);
    values[index(1, 2, 3)] = 9;
    values[index(3, 0, 1)] = 9;
    values[index(2, 2, 2)] = 8;
    let input = bucket::<u16>(&values);
    let empty = [i32::MAX, i32::MAX, i32::MAX, i32::MIN, i32::MIN, i32::MIN];
    let extend = |segment_id, existing| {
        extend_segment_bounding_box(&input, 2, false, 4, segment_id, [10, 20, 30], existing)
    };
    assert_eq!(extend(9, empty).unwrap(), [11, 20, 31, 13, 22, 33]);
    assert_eq!(extend(8, empty).unwrap(), [12, 22, 32, 12, 22, 32]);
    assert_eq!(extend(7, empty).unwrap(), empty);
    let existing = [0, 21, 32, 12, 21, 40];
    assert_eq!(extend(9, existing).unwrap(), [0, 20, 31, 13, 22, 40]);
    assert!(extend_segment_bounding_box(&input, 2, false, 3, 9, [0; 3], empty).is_err());
    assert!(extend_segment_bounding_box(&[0u8; 3 * 8], 3, false, 2, 9, [0; 3], empty).is_err());
    assert_eq!(
        extend_segment_bounding_box(&[], 3, false, 0, 9, [0; 3], empty).unwrap(),
        empty
    );
}

#[test]
fn applies_a_segment_id_mapping() {
    let values = [0, 1, 1, 2, 3, -1];
    let input = bucket::<i16>(&values);
    let output =
        apply_segment_id_mapping(&input, 2, true, &[1, 2, 1, -1], &[10, 20, 11, 300]).unwrap();
    // unmapped ids become 0, the later of duplicate keys wins
    assert_eq!(output, bucket::<i16>(&[0, 11, 11, 20, 0, 300]));
    assert!(apply_segment_id_mapping(&input, 2, true, &[1, 2], &[1]).is_err());
    assert!(apply_segment_id_mapping(&[0u8; 6], 3, true, &[], &[]).is_err());
    assert!(
        apply_segment_id_mapping(&[], 3, true, &[], &[])
            .unwrap()
            .is_empty()
    );
}

#[test]
fn merges_volume_buckets_in_place() {
    let incoming = bucket::<u32>(&[0, 1, 2, 0, 3]);
    let mut merged = bucket::<u32>(&[7, 7, 7, 7, 7]);
    merge_volume_bucket_in_place(&mut merged, &incoming, false, &[1, 2], &[10, 20], 4, false)
        .unwrap();
    assert_eq!(merged, bucket::<u32>(&[7, 10, 20, 7, 0]));

    let mut merged = bucket::<u32>(&[7, 7, 7, 7, 7]);
    merge_volume_bucket_in_place(&mut merged, &incoming, true, &[1], &[10], 4, false).unwrap();
    assert_eq!(merged, bucket::<u32>(&[7, 1, 2, 7, 3]));

    let mut merged = bucket::<u32>(&[7, 7, 7, 7, 7]);
    assert!(
        merge_volume_bucket_in_place(&mut merged, &incoming, true, &[1], &[], 4, false).is_err()
    );
    assert!(
        merge_volume_bucket_in_place(&mut merged, &incoming[4..], true, &[], &[], 4, false)
            .is_err()
    );
    assert_eq!(merged, bucket::<u32>(&[7, 7, 7, 7, 7]));
}

#[test]
fn deletes_a_segment() {
    let input = bucket::<u64>(&[1, -1, 2, -1]);
    assert_eq!(
        delete_segment_from_bucket(&input, 8, false, -1).unwrap(),
        bucket::<u64>(&[1, 0, 2, 0])
    );
    assert!(delete_segment_from_bucket(&[0u8; 6], 3, false, 0).is_err());
    assert!(delete_segment_from_bucket(&[0u8; 5], 2, false, 0).is_err());
    assert!(
        delete_segment_from_bucket(&[], 3, false, 0)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn applies_voxel_runs_to_a_copy() {
    let count = voxel_runs::BUCKET_VOXEL_COUNT;
    let input = vec![1u8; count * 2];
    // format version 1, axis 0, value 0x0203, 2 runs: (gap 1, length 2), (gap 0, length 1)
    let mut runs = vec![1u8, 0, 3, 2, 0, 0, 0, 0, 0, 0, 2, 1, 2, 0, 1];
    let output = apply_voxel_runs(&input, 2, &runs).unwrap();
    assert_eq!(&output[..10], &[1, 1, 3, 2, 3, 2, 3, 2, 1, 1]);
    assert_eq!(&output[10..], &input[10..]);
    assert!(apply_voxel_runs(&input[..1024], 2, &runs).is_err());
    assert!(apply_voxel_runs(&vec![0u8; count * 3], 3, &runs).is_err());
    runs.push(0);
    assert!(apply_voxel_runs(&input, 2, &runs).is_err());
}
