//! Scala `ChunkUtils`.

use crate::error::{DsError, DsResult};

fn arithmetic(message: &str) -> DsError {
    DsError {
        exception: Some(format!("java.lang.ArithmeticException: {message}")),
        ..DsError::failure(message)
    }
}

/// Scala `ChunkUtils.computeChunkIndices`: all chunk indices touched by the selection, clamped
/// to the array bounds (if known), in C order (last dimension fastest). Divisions truncate
/// toward zero like Java `long` division.
pub fn compute_chunk_indices(
    array_shape: Option<&[i64]>,
    array_chunk_shape: &[i32],
    selected_shape: &[i32],
    selected_offset: &[i64],
) -> DsResult<Vec<Vec<i64>>> {
    let n_dims = array_chunk_shape.len();
    if selected_shape.len() < n_dims
        || selected_offset.len() < n_dims
        || array_shape.is_some_and(|s| s.len() < n_dims)
    {
        let len = selected_shape
            .len()
            .min(selected_offset.len())
            .min(array_shape.map_or(usize::MAX, <[i64]>::len));
        let message = format!("Index {len} out of bounds for length {len}");
        return Err(DsError {
            exception: Some(format!(
                "java.lang.ArrayIndexOutOfBoundsException: {message}"
            )),
            ..DsError::failure(message)
        });
    }
    let mut start = vec![0i64; n_dims];
    let mut end = vec![0i64; n_dims];
    let mut num_chunks: i64 = 1;
    for dim in 0..n_dims {
        let chunk = i64::from(array_chunk_shape[dim]);
        if chunk == 0 {
            return Err(arithmetic("/ by zero"));
        }
        let largest_possible_index = array_shape.map(|shape| (shape[dim] - 1) / chunk);
        let start_raw = selected_offset[dim] / chunk;
        let start_clamped = 0i64.max(largest_possible_index.unwrap_or(start_raw).min(start_raw));
        let end_raw = (selected_offset[dim] + i64::from(selected_shape[dim]) - 1) / chunk;
        let end_clamped_to_bbox = 0i64.max(largest_possible_index.unwrap_or(end_raw).min(end_raw));
        let end_clamped = start_clamped.max(end_clamped_to_bbox);
        start[dim] = start_clamped;
        end[dim] = end_clamped;
        num_chunks = num_chunks.wrapping_mul(end_clamped - start_clamped + 1);
    }
    let num_chunks = i32::try_from(num_chunks).map_err(|_| arithmetic("integer overflow"))?;
    let num_chunks = usize::try_from(num_chunks).map_err(|_| {
        let message = format!("{num_chunks}");
        DsError {
            exception: Some(format!("java.lang.NegativeArraySizeException: {message}")),
            ..DsError::failure(message)
        }
    })?;
    let mut indices = Vec::with_capacity(num_chunks.min(1 << 16));
    let mut current = start.clone();
    for _ in 0..num_chunks {
        indices.push(current.clone());
        let mut dim = n_dims;
        while dim > 0 {
            let d = dim - 1;
            if current[d] >= end[d] {
                current[d] = start[d];
                dim -= 1;
            } else {
                current[d] += 1;
                break;
            }
        }
    }
    Ok(indices)
}

#[cfg(test)]
mod tests {
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
}
