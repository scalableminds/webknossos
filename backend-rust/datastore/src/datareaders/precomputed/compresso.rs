//! Compresso v0/v1 whole-volume decoder; no native runtime linkage.
//! Format/semantics ported from webknossos-jni/src/include/compresso.hpp.
//! Connected components use first-raster-occurrence numbering, as cc3d.hpp does.
// Copyright (c) 2016 Rhoana, 2021 William Silversmith
// MIT License
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

use crate::error::{DsError, DsResult};
const HEADER_SIZE: usize = 36;
pub const MAX_OUTPUT_BYTES: usize = 300 * 1024 * 1024;
const MAX_WORKING_BYTES: usize = 512 * 1024 * 1024;
fn error(message: impl std::fmt::Display) -> DsError {
    DsError::failure(format!(
        "An error occurred in native code: Error while decoding with compresso: {message}"
    ))
}
fn integer(bytes: &[u8]) -> u64 {
    let mut value = [0u8; 8];
    value[..bytes.len()].copy_from_slice(bytes);
    u64::from_le_bytes(value)
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressoHeader {
    pub version: u8,
    pub label_width: usize,
    pub shape: [usize; 3],
    pub steps: [usize; 3],
    pub id_count: usize,
    pub value_count: usize,
    pub location_count: usize,
    pub connectivity: u8,
}
impl CompressoHeader {
    pub fn parse(input: &[u8]) -> DsResult<Self> {
        if input.len() < HEADER_SIZE {
            return Err(error(format!(
                "Expected at least 36 bytes of input for the compresso header, got {}",
                input.len()
            )));
        }
        let version = input[4];
        let label_width = usize::from(input[5]);
        let connectivity = input[35];
        // JNI checks the raw output length before validating magic/type/version.
        if label_width == 0
            || input[6..12]
                .as_chunks::<2>()
                .0
                .iter()
                .any(|v| u16::from_le_bytes(*v) == 0)
        {
            return Err(error("output length as read from header must be >0, got 0"));
        }

        if &input[..4] != b"cpso"
            || version > 1
            || ![1, 2, 4, 8].contains(&label_width)
            || !(connectivity == 4 || (version == 0 && connectivity == 6))
        {
            return Err(error(12));
        }
        let count = |from, to| {
            usize::try_from(integer(&input[from..to])).map_err(|_| error("table count overflow"))
        };
        let shape = [count(6, 8)?, count(8, 10)?, count(10, 12)?];
        let steps = input[12..15]
            .iter()
            .map(|v| usize::from(*v))
            .collect::<Vec<_>>();
        let steps: [usize; 3] = steps.try_into().expect("three step bytes");
        if shape.contains(&0) {
            return Err(error("output length as read from header must be >0, got 0"));
        }
        if steps.contains(&0) || steps.iter().product::<usize>() > 64 {
            return Err(error("invalid boundary grid steps"));
        }
        Ok(Self {
            version,
            label_width,
            shape,
            steps,
            id_count: count(15, 23)?,
            value_count: count(23, 27)?,
            location_count: count(27, 35)?,
            connectivity,
        })
    }
    fn voxels(&self) -> DsResult<usize> {
        self.shape
            .iter()
            .try_fold(1usize, |p, d| p.checked_mul(*d))
            .ok_or_else(|| error("volume overflow"))
    }
    fn window_width(&self) -> usize {
        match self.steps.iter().product::<usize>() {
            0..=8 => 1,
            9..=16 => 2,
            17..=32 => 4,
            _ => 8,
        }
    }
    fn index_width(&self) -> usize {
        let worst = 2 * self.shape[0] * self.shape[1];
        // Native uses strict comparison at the unsigned maximum, not <=.
        if worst < usize::from(u8::MAX) {
            1
        } else if worst < usize::from(u16::MAX) {
            2
        } else if (worst as u64) < u64::from(u32::MAX) {
            4
        } else {
            8
        }
    }
}
struct Table<'a> {
    bytes: &'a [u8],
    width: usize,
}
impl Table<'_> {
    fn len(&self) -> usize {
        self.bytes.len() / self.width
    }
    fn get(&self, index: usize) -> DsResult<u64> {
        let start = index
            .checked_mul(self.width)
            .ok_or_else(|| error("table offset overflow"))?;
        let end = start
            .checked_add(self.width)
            .ok_or_else(|| error("table offset overflow"))?;
        self.bytes
            .get(start..end)
            .map(integer)
            .ok_or_else(|| error("truncated or invalid table index"))
    }
}
fn zeroed(len: usize) -> DsResult<Vec<u8>> {
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(len)
        .map_err(|_| error("could not allocate decoder buffer"))?;
    bytes.resize(len, 0);
    Ok(bytes)
}

pub fn decode(input: &[u8], output_limit: usize) -> DsResult<Vec<u8>> {
    let header = CompressoHeader::parse(input)?;
    let voxels = header.voxels()?;
    let limit = output_limit.min(MAX_OUTPUT_BYTES);
    let length = voxels
        .checked_mul(header.label_width)
        .ok_or_else(|| error("output length overflow"))?;
    if length > limit {
        return Err(error(format!("output exceeds {limit} bytes")));
    }
    // Byte boundary/visited map + u32 flood-fill stack + output, all bounded before allocation.
    if voxels
        .checked_mul(header.label_width + 5)
        .is_none_or(|n| n > MAX_WORKING_BYTES)
    {
        return Err(error("decoder working set exceeds 512 MiB"));
    }
    let width = header.window_width();
    let mut offset = HEADER_SIZE;
    let mut table = |count: usize, width: usize| -> DsResult<Table<'_>> {
        let end = count
            .checked_mul(width)
            .and_then(|n| n.checked_add(offset))
            .ok_or_else(|| error("table length overflow"))?;
        let bytes = input
            .get(offset..end)
            .ok_or_else(|| error("truncated tables"))?;
        offset = end;
        Ok(Table { bytes, width })
    };
    let ids = table(header.id_count, header.label_width)?;
    let values = table(header.value_count, width)?;
    let locations = table(header.location_count, header.label_width)?;
    let index_bytes = if header.version == 1 {
        2 * header.shape[2] * header.index_width()
    } else {
        0
    };
    let end = input
        .len()
        .checked_sub(index_bytes)
        .filter(|e| *e >= offset)
        .ok_or_else(|| error("truncated z index"))?;
    let windows = Table {
        bytes: &input[offset..end],
        width,
    };
    if !windows.bytes.len().is_multiple_of(width) {
        return Err(error("truncated boundary windows"));
    }
    let grid = std::array::from_fn::<_, 3, _>(|i| header.shape[i].div_ceil(header.steps[i]));
    let blocks = grid.iter().product::<usize>();
    let mut position = 0usize;
    for index in 0..windows.len() {
        let word = windows.get(index)?;
        if word & 1 == 1 {
            position = usize::try_from(word >> 1)
                .ok()
                .and_then(|n| position.checked_add(n))
                .filter(|p| *p <= blocks)
                .ok_or_else(|| error("boundary run exceeds grid"))?;
        } else {
            if position >= blocks {
                return Err(error("boundary window exceeds grid"));
            }
            if !values.bytes.is_empty() && (word >> 1) >= header.value_count as u64 {
                return Err(error("invalid boundary value index"));
            }
            position += 1;
        }
    }
    let mut boundaries = zeroed(voxels)?;
    if header.value_count > 0 {
        let [sx, sy, sz] = header.shape;
        let [xs, ys, zs] = header.steps;
        let sxy = sx * sy;
        let mut command = 0;
        let mut zeros = 0;
        for block in 0..blocks {
            let index = loop {
                if zeros > 0 {
                    zeros -= 1;
                    break 0;
                }
                if command == windows.len() {
                    break 0;
                }
                let word = windows.get(command)?;
                command += 1;
                if word & 1 == 1 {
                    zeros =
                        usize::try_from(word >> 1).map_err(|_| error("boundary run overflow"))?;
                } else {
                    break usize::try_from(word >> 1)
                        .map_err(|_| error("boundary index overflow"))?;
                }
            };
            let mask = values.get(index)?;
            let x0 = (block % grid[0]) * xs;
            let y0 = ((block / grid[0]) % grid[1]) * ys;
            let z0 = (block / grid[0] / grid[1]) * zs;
            for z in z0..(z0 + zs).min(sz) {
                for y in y0..(y0 + ys).min(sy) {
                    for x in x0..(x0 + xs).min(sx) {
                        let bit = (x - x0) + xs * ((y - y0) + ys * (z - z0));
                        boundaries[x + sx * y + sxy * z] = ((mask >> bit) & 1) as u8;
                    }
                }
            }
        }
    }
    let mut output = zeroed(length)?;
    fill_components(&mut boundaries, &mut output, &ids, &header)?;
    fill_boundaries(&boundaries, &mut output, &locations, &header)?;
    Ok(output)
}

fn write_label(output: &mut [u8], voxel: usize, width: usize, label: u64) {
    output[voxel * width..(voxel + 1) * width].copy_from_slice(&label.to_le_bytes()[..width]);
}
fn copy_label(output: &mut [u8], voxel: usize, neighbor: usize, width: usize) {
    output.copy_within(neighbor * width..(neighbor + 1) * width, voxel * width);
}
fn fill_components(
    boundaries: &mut [u8],
    output: &mut [u8],
    ids: &Table<'_>,
    h: &CompressoHeader,
) -> DsResult<()> {
    let [sx, sy, sz] = h.shape;
    let sxy = sx * sy;
    let mut component = 0;
    let mut stack = Vec::<u32>::new();
    stack
        .try_reserve_exact(boundaries.len())
        .map_err(|_| error("could not allocate component stack"))?;
    for first in 0..boundaries.len() {
        if boundaries[first] != 0 {
            continue;
        }
        let label = ids.get(component)?;
        component += 1;
        boundaries[first] = 2;
        stack.push(first as u32);
        while let Some(index) = stack.pop() {
            let index = index as usize;
            write_label(output, index, h.label_width, label);
            let x = index % sx;
            let y = (index / sx) % sy;
            let z = index / sxy;
            let mut visit = |neighbor: usize| {
                if boundaries[neighbor] == 0 {
                    boundaries[neighbor] = 2;
                    stack.push(neighbor as u32);
                }
            };
            if x > 0 {
                visit(index - 1);
            }
            if x + 1 < sx {
                visit(index + 1);
            }
            if y > 0 {
                visit(index - sx);
            }
            if y + 1 < sy {
                visit(index + sx);
            }
            if h.connectivity == 6 {
                if z > 0 {
                    visit(index - sxy);
                }
                if z + 1 < sz {
                    visit(index + sxy);
                }
            }
        }
    }
    Ok(())
}
fn fill_boundaries(
    boundaries: &[u8],
    output: &mut [u8],
    locations: &Table<'_>,
    h: &CompressoHeader,
) -> DsResult<()> {
    let [sx, sy, sz] = h.shape;
    let sxy = sx * sy;
    let mut instruction = 0;
    for index in 0..boundaries.len() {
        if boundaries[index] != 1 {
            continue;
        }
        let x = index % sx;
        let y = (index / sx) % sy;
        let z = index / sxy;
        let automatic = if x > 0 && boundaries[index - 1] != 1 {
            Some(index - 1)
        } else if y > 0 && boundaries[index - sx] != 1 {
            Some(index - sx)
        } else if h.connectivity == 6 && z > 0 && boundaries[index - sxy] != 1 {
            Some(index - sxy)
        } else {
            None
        };
        if let Some(neighbor) = automatic {
            copy_label(output, index, neighbor, h.label_width);
            continue;
        }
        if locations.len() == 0 {
            return Err(error(1));
        }
        let offset = locations.get(instruction)?;
        instruction += 1;
        let neighbor = match offset {
            0 => {
                if x == 0 {
                    return Err(error(2));
                }
                Some(index - 1)
            }
            1 => {
                if x + 1 >= sx {
                    return Err(error(3));
                }
                Some(index + 1)
            }
            2 => {
                if y == 0 {
                    return Err(error(4));
                }
                Some(index - sx)
            }
            3 => {
                if y + 1 >= sy {
                    return Err(error(5));
                }
                Some(index + sx)
            }
            4 => {
                if z == 0 {
                    return Err(error(6));
                }
                Some(index - sxy)
            }
            5 => {
                if z + 1 >= sz {
                    return Err(error(7));
                }
                Some(index + sxy)
            }
            6 => {
                let label = locations.get(instruction)?;
                instruction += 1;
                write_label(output, index, h.label_width, label);
                None
            }
            value => {
                write_label(output, index, h.label_width, value - 7);
                None
            }
        };
        if let Some(neighbor) = neighbor {
            copy_label(output, index, neighbor, h.label_width);
        }
    }
    Ok(())
}
