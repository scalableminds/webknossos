//! Voxel runs: the sparse wire format in which `updateBucketPartial` sends the voxels of a bucket that were set
//! to one value (`encodeBucketDiff` in the frontend's `viewer/model/volumetracing/core/bucket_diff.ts`).
//!
//! Little-endian: `u8 formatVersion (1), u8 runAxis, u64 value, varint runCount`, then `runCount` times
//! `(varint gap, varint length)`. Runs are over the linear index of the run order whose fastest axis is
//! `runAxis` (0: x,y,z; 1: y,z,x; 2: z,x,y), may cross rows and slices, and each gap is the distance from the
//! previous run's end. Varints are unsigned LEB128.

use crate::bucket_scanner::Element;
use crate::jni_util::{NativeResult, invalid_argument};

const FORMAT_VERSION: u8 = 1;
const HEADER_SIZE_BYTES: usize = 10;
const BUCKET_WIDTH: usize = 32;
/// Voxel runs can only be applied to buckets of this many elements.
pub const BUCKET_VOXEL_COUNT: usize = BUCKET_WIDTH * BUCKET_WIDTH * BUCKET_WIDTH;

/// The header of a validated voxel runs buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VoxelRunsHeader {
    pub run_axis: u8,
    pub value: u64,
    pub run_count: usize,
    /// Byte offset of the first run.
    pub runs_offset: usize,
}

/// Reads an unsigned LEB128 varint at `offset` and advances it. Gaps, lengths and the run count never exceed
/// 32768, so a varint has at most 3 bytes.
#[inline(always)]
fn read_varint(bytes: &[u8], offset: &mut usize) -> NativeResult<usize> {
    let mut result = 0usize;
    for shift in [0, 7, 14] {
        let Some(&byte) = bytes.get(*offset) else {
            return invalid_argument("voxelRuns buffer ends inside a varint");
        };
        *offset += 1;
        result |= ((byte & 0x7f) as usize) << shift;
        if byte & 0x80 == 0 {
            return Ok(result);
        }
    }
    invalid_argument("varint in voxelRuns buffer is too long")
}

/// Checks the whole buffer without writing anything, so that a malformed one is rejected before the bucket is
/// touched.
pub fn validate(bytes: &[u8]) -> NativeResult<VoxelRunsHeader> {
    if bytes.len() < HEADER_SIZE_BYTES {
        return invalid_argument("voxelRuns buffer is smaller than the mandatory 10-byte header");
    }
    if bytes[0] != FORMAT_VERSION {
        return invalid_argument("unknown voxelRuns format version");
    }
    let run_axis = bytes[1];
    if run_axis > 2 {
        return invalid_argument("unknown run axis in voxelRuns buffer");
    }
    let value = u64::from_le_bytes(bytes[2..HEADER_SIZE_BYTES].try_into().unwrap());

    let mut offset = HEADER_SIZE_BYTES;
    let run_count = read_varint(bytes, &mut offset)?;
    if run_count > BUCKET_VOXEL_COUNT {
        return invalid_argument("voxelRuns buffer declares more runs than a bucket has voxels");
    }
    let runs_offset = offset;
    let mut linear = 0usize;
    for _ in 0..run_count {
        linear += read_varint(bytes, &mut offset)?;
        linear += read_varint(bytes, &mut offset)?;
        if linear > BUCKET_VOXEL_COUNT {
            return invalid_argument("voxel run exceeds bucket bounds");
        }
    }
    // A truncated buffer fails above; trailing bytes mean it is not what the encoder wrote.
    if offset != bytes.len() {
        return invalid_argument("voxelRuns buffer has trailing bytes after the declared runs");
    }
    Ok(VoxelRunsHeader {
        run_axis,
        value,
        run_count,
        runs_offset,
    })
}

/// Iterates over the `(start, end)` linear index ranges of the runs of a validated buffer.
fn runs(bytes: &[u8], header: &VoxelRunsHeader) -> impl Iterator<Item = (usize, usize)> {
    let mut offset = header.runs_offset;
    let mut linear = 0usize;
    (0..header.run_count).map(move |_| {
        // The buffer was validated, so reading cannot fail.
        linear += read_varint(bytes, &mut offset).unwrap();
        let start = linear;
        linear += read_varint(bytes, &mut offset).unwrap();
        (start, linear)
    })
}

/// Writes validated voxel runs into a bucket of [BUCKET_VOXEL_COUNT] elements of type `T`. The value is
/// written as its low `T::SIZE` bytes, so the signedness of `T` does not matter.
pub fn write<T: Element>(bytes: &[u8], header: &VoxelRunsHeader, bucket: &mut [u8]) {
    assert_eq!(bucket.len(), BUCKET_VOXEL_COUNT * T::SIZE);
    let value = header.value as i64;
    match header.run_axis {
        1 => write_y_order::<T>(bytes, header, bucket, value),
        2 => write_z_order::<T>(bytes, header, bucket, value),
        _ => write_x_order::<T>(bytes, header, bucket, value),
    }
}

/// Sets the elements `start..end` of the bucket to `value`.
#[inline(always)]
fn fill<T: Element>(bucket: &mut [u8], start: usize, end: usize, value: i64) {
    for element in bucket[start * T::SIZE..end * T::SIZE].chunks_exact_mut(T::SIZE) {
        T::write(element, value);
    }
}

// The three run orders are written differently, each so that the writes stay cache-friendly.

/// x order: every run is one contiguous range of the bucket.
fn write_x_order<T: Element>(
    bytes: &[u8],
    header: &VoxelRunsHeader,
    bucket: &mut [u8],
    value: i64,
) {
    for (start, end) in runs(bytes, header) {
        fill::<T>(bucket, start, end, value);
    }
}

/// y order (y, z, x): a run is a sequence of y-segments, each written with a stride of one row (32 elements).
/// Unlike z order, that stride spreads over the cache sets, so writing directly is fast.
fn write_y_order<T: Element>(
    bytes: &[u8],
    header: &VoxelRunsHeader,
    bucket: &mut [u8],
    value: i64,
) {
    for (start, end) in runs(bytes, header) {
        let mut remaining = end - start;
        let mut y = start % BUCKET_WIDTH;
        let mut z = (start / BUCKET_WIDTH) % BUCKET_WIDTH;
        let mut x = start / (BUCKET_WIDTH * BUCKET_WIDTH);
        while remaining > 0 {
            let count = (BUCKET_WIDTH - y).min(remaining);
            let segment_start = x + (y + z * BUCKET_WIDTH) * BUCKET_WIDTH;
            for k in 0..count {
                let index = (segment_start + k * BUCKET_WIDTH) * T::SIZE;
                T::write(&mut bucket[index..index + T::SIZE], value);
            }
            remaining -= count;
            y = 0;
            z += 1;
            if z == BUCKET_WIDTH {
                z = 0;
                x += 1;
            }
        }
    }
}

/// In-place transpose of a 32x32 bit matrix: bit c of `rows[r]` becomes bit r of `rows[c]`. Swaps ever smaller
/// off-diagonal blocks (16, 8, ..., 1), as in Hacker's Delight, with LSB-first bits. The inverse of what
/// `BucketVoxelMask.orderedRuns` does in the frontend.
fn transpose32(rows: &mut [u32; 32]) {
    let mut mask: u32 = 0x0000_ffff;
    let mut size = 16;
    while size != 0 {
        let mut k = 0;
        while k < 32 {
            let swap = ((rows[k] >> size) ^ rows[k + size]) & mask;
            rows[k] ^= swap << size;
            rows[k + size] ^= swap;
            k = (k + size + 1) & !size;
        }
        size >>= 1;
        mask ^= mask << size;
    }
}

/// z order (z, x, y): writing z-segments directly would mean a stride of 1024 elements, and addresses 4 KB
/// apart all fall into the same L1 cache set, which thrashes it. Instead, the runs are set as bits in run
/// order, where word x + 32y holds z = 0..31 of the slice y. Transposing a touched slice turns it into x-rows
/// y + 32z, which are written like x-runs.
fn write_z_order<T: Element>(
    bytes: &[u8],
    header: &VoxelRunsHeader,
    bucket: &mut [u8],
    value: i64,
) {
    let mut slices = [[0u32; BUCKET_WIDTH]; BUCKET_WIDTH];
    let mut touched_slices = 0u32; // bit y: slice y has a run
    for (start, end) in runs(bytes, header) {
        let mut linear = start;
        while linear < end {
            let word = linear / 32;
            let slice = word / BUCKET_WIDTH;
            touched_slices |= 1 << slice;
            let bit = linear % 32;
            let bits = (32 - bit).min(end - linear);
            slices[slice][word % BUCKET_WIDTH] |= (((1u64 << bits) - 1) << bit) as u32;
            linear += bits;
        }
    }
    while touched_slices != 0 {
        let y = touched_slices.trailing_zeros() as usize;
        touched_slices &= touched_slices - 1;
        let slice = &mut slices[y]; // slice[x] has bit z
        transpose32(slice); // slice[z] has bit x
        for (z, &row) in slice.iter().enumerate() {
            let row_start = (y + z * BUCKET_WIDTH) * BUCKET_WIDTH;
            let mut row = row;
            while row != 0 {
                let start = row.trailing_zeros();
                let length = (!(row >> start)).trailing_zeros(); // 32 for a full row
                fill::<T>(
                    bucket,
                    row_start + start as usize,
                    row_start + (start + length) as usize,
                    value,
                );
                row &= !((((1u64 << length) - 1) << start) as u32);
            }
        }
    }
}

#[cfg(test)]
mod tests;
