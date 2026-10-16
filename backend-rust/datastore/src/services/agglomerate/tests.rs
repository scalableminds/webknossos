use super::*;

#[test]
fn maps_segment_ids_like_the_native_scanner() {
    let data: Vec<u8> = [5u16, 7, 5, 0]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    let mut ids = collect_segment_ids(&data, 2, false).unwrap();
    ids.sort_unstable();
    assert_eq!(ids, [0, 5, 7]);
    let mapped = apply_segment_id_mapping(&data, 2, false, &[5, 7], &[70000, 9]).unwrap();
    let values: Vec<u16> = mapped
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .collect();
    // 70000 truncated to 16 bits; unmapped 0 stays 0.
    assert_eq!(values, [70000u32 as u16, 9, 70000u32 as u16, 0]);
    assert!(collect_segment_ids(&[1, 2, 3], 2, false).is_err());
}
