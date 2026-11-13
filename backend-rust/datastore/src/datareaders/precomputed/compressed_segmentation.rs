//! Bounded compressed_segmentation decoder (Neuroglancer LUT + packed block indices).
use crate::{
    datareaders::{ArrayDataType, assert_chunk_size_limit},
    error::{DsError, DsResult},
    models::Vec3Int,
};
fn bad() -> DsError {
    DsError::failure("Malformed compressed_segmentation chunk")
}
pub fn decode(
    input: &[u8],
    volume: &[i32],
    channels: usize,
    block: Vec3Int,
    dtype: ArrayDataType,
) -> DsResult<Vec<u8>> {
    let width = match dtype {
        ArrayDataType::U4 => 4,
        ArrayDataType::U8 => 8,
        _ => {
            return Err(DsError::failure(
                "Can not use compressed segmentation for datatypes other than u4, u8.",
            ));
        }
    };
    if volume.len() != 3
        || channels == 0
        || volume.iter().any(|d| *d <= 0)
        || [block.x, block.y, block.z].iter().any(|d| *d <= 0)
        || !input.len().is_multiple_of(4)
    {
        return Err(bad());
    }
    let shape = [volume[0] as usize, volume[1] as usize, volume[2] as usize];
    let block = [block.x as usize, block.y as usize, block.z as usize];
    let count = shape
        .iter()
        .try_fold(channels, |p, d| p.checked_mul(*d))
        .and_then(|p| p.checked_mul(width))
        .ok_or_else(bad)?;
    assert_chunk_size_limit(i64::try_from(count).unwrap_or(i64::MAX))?;
    let words: Vec<u32> = input
        .as_chunks::<4>()
        .0
        .iter()
        .map(|w| u32::from_le_bytes(*w))
        .collect();
    let mut output = vec![0u8; count];
    let grid = [
        shape[0].div_ceil(block[0]),
        shape[1].div_ceil(block[1]),
        shape[2].div_ceil(block[2]),
    ];
    let get = |base: usize, i: usize| {
        words
            .get(base.checked_add(i).ok_or_else(bad)?)
            .copied()
            .ok_or_else(bad)
    };
    for channel in 0..channels {
        let base = *words.get(channel).ok_or_else(bad)? as usize;
        if base < channels {
            return Err(bad());
        }
        for bz in 0..grid[2] {
            for by in 0..grid[1] {
                for bx in 0..grid[0] {
                    let id = bx + grid[0] * (by + grid[1] * bz);
                    let h = get(base, id * 2)?;
                    let table = (h & 0xffffff) as usize;
                    let bits = (h >> 24) as usize;
                    if ![0, 1, 2, 4, 8, 16, 32].contains(&bits) {
                        return Err(bad());
                    }
                    let packed = get(base, id * 2 + 1)? as usize;
                    let start = [bx * block[0], by * block[1], bz * block[2]];
                    for z in start[2]..(start[2] + block[2]).min(shape[2]) {
                        for y in start[1]..(start[1] + block[1]).min(shape[1]) {
                            for x in start[0]..(start[0] + block[0]).min(shape[0]) {
                                let bit = ((z - start[2]) * block[1] + y - start[1])
                                    .checked_mul(block[0])
                                    .and_then(|p| p.checked_add(x - start[0]))
                                    .and_then(|p| p.checked_mul(bits))
                                    .ok_or_else(bad)?;
                                let value = if bits == 0 {
                                    0
                                } else {
                                    let word =
                                        get(base, packed.checked_add(bit / 32).ok_or_else(bad)?)?;
                                    let mask = if bits == 32 {
                                        u32::MAX
                                    } else {
                                        (1u32 << bits) - 1
                                    };
                                    ((word >> (bit % 32)) & mask) as usize
                                };
                                let address = table
                                    .checked_add(value.checked_mul(width / 4).ok_or_else(bad)?)
                                    .ok_or_else(bad)?;
                                let target = (((channel * shape[2] + z) * shape[1] + y) * shape[0]
                                    + x)
                                    * width;
                                output[target..target + 4]
                                    .copy_from_slice(&get(base, address)?.to_le_bytes());
                                if width == 8 {
                                    output[target + 4..target + 8]
                                        .copy_from_slice(&get(base, address + 1)?.to_le_bytes());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(output)
}
