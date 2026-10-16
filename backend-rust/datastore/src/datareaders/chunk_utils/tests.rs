use super::*;

#[test]
fn single_and_multiple_chunks() {
    let r = compute_chunk_indices(Some(&[100, 100]), &[32, 32], &[32, 32], &[32, 64]).unwrap();
    assert_eq!(r, vec![vec![1, 2]]);
    let r = compute_chunk_indices(Some(&[100, 100]), &[32, 32], &[32, 32], &[16, 16]).unwrap();
    assert_eq!(r, vec![vec![0, 0], vec![0, 1], vec![1, 0], vec![1, 1]]);
}

#[test]
fn clamping_to_array_bounds() {
    // beyond the array: start clamped to the largest index
    let r = compute_chunk_indices(Some(&[50]), &[32], &[32], &[96]).unwrap();
    assert_eq!(r, vec![vec![1]]);
    // negative offsets: Java division truncates toward zero, then clamped to 0
    let r = compute_chunk_indices(Some(&[50]), &[32], &[32], &[-40]).unwrap();
    assert_eq!(r, vec![vec![0]]);
    // unknown shape: no upper clamp
    let r = compute_chunk_indices(None, &[32], &[64], &[96]).unwrap();
    assert_eq!(r, vec![vec![3], vec![4]]);
    assert!(compute_chunk_indices(None, &[0], &[1], &[0]).is_err());
}
