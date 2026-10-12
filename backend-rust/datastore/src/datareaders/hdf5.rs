//! Pure-Rust HDF5 subset adapter: numeric hyperslabs and root scalar/string attributes.
//! FileStorage uses positional reads, not a whole-file copy or a writable memory map.
use crate::error::{DsError, DsResult};
use hdf5_reader::{Dataset, Datatype, H5Type, Hdf5File, OpenOptions, SliceInfo, SliceInfoElem};
use std::path::Path;
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CHUNK_BYTES: u64 = 300 * 1024 * 1024;
fn failure(e: impl std::fmt::Display) -> DsError {
    DsError::failure(format!("Could not read HDF5 file: {e}"))
}

pub struct Hdf5Reader {
    file: Hdf5File,
}
impl Hdf5Reader {
    pub fn open(path: &Path) -> DsResult<Self> {
        if !path.exists() {
            return Err(DsError::failure("Could not open mesh file for reading."));
        }
        let file = Hdf5File::open_with_options(
            path,
            OpenOptions {
                chunk_cache_bytes: 8 * 1024 * 1024,
                chunk_cache_slots: 257,
                ..OpenOptions::default()
            },
        )
        .map_err(failure)?;
        Ok(Self { file })
    }
    pub fn root_u64(&self, name: &str) -> DsResult<u64> {
        let attr = self
            .file
            .root_group()
            .map_err(failure)?
            .attribute(name)
            .map_err(failure)?;
        macro_rules! signed {
            ($t:ty) => {
                attr.read_scalar::<$t>()
                    .map(|v| v.max(0) as u64)
                    .map_err(failure)
            };
        }
        macro_rules! unsigned {
            ($t:ty) => {
                attr.read_scalar::<$t>().map(u64::from).map_err(failure)
            };
        }
        match attr.datatype {
            Datatype::FixedPoint { size, signed, .. } => match (size, signed) {
                (1, false) => unsigned!(u8),
                (2, false) => unsigned!(u16),
                (4, false) => unsigned!(u32),
                (8, false) => attr.read_scalar::<u64>().map_err(failure),
                (1, true) => signed!(i8),
                (2, true) => signed!(i16),
                (4, true) => signed!(i32),
                (8, true) => signed!(i64),
                _ => Err(failure("unsupported integer attribute width")),
            },
            _ => Err(failure("expected integer attribute")),
        }
    }
    pub fn root_string(&self, name: &str) -> DsResult<String> {
        self.file
            .root_group()
            .map_err(failure)?
            .attribute(name)
            .map_err(failure)?
            .read_string()
            .map_err(failure)
    }
    pub fn root_i64(&self, name: &str) -> DsResult<i64> {
        let attr = self
            .file
            .root_group()
            .map_err(failure)?
            .attribute(name)
            .map_err(failure)?;
        macro_rules! signed {
            ($t:ty) => {
                attr.read_scalar::<$t>().map(i64::from).map_err(failure)
            };
        }
        macro_rules! unsigned {
            ($t:ty) => {
                attr.read_scalar::<$t>().map(i64::from).map_err(failure)
            };
        }
        match attr.datatype {
            Datatype::FixedPoint { size, signed, .. } => match (size, signed) {
                (1, false) => unsigned!(u8),
                (2, false) => unsigned!(u16),
                (4, false) => unsigned!(u32),
                (8, false) => attr
                    .read_scalar::<u64>()
                    .map(|v| v.min(i64::MAX as u64) as i64)
                    .map_err(failure),
                (1, true) => signed!(i8),
                (2, true) => signed!(i16),
                (4, true) => signed!(i32),
                (8, true) => attr.read_scalar::<i64>().map_err(failure),
                _ => Err(failure("unsupported integer attribute width")),
            },
            _ => Err(failure("expected integer attribute")),
        }
    }
    fn root_floats(&self, name: &str) -> DsResult<(Vec<u64>, Vec<f64>)> {
        let attr = self
            .file
            .root_group()
            .map_err(failure)?
            .attribute(name)
            .map_err(failure)?;
        if attr.num_elements().map_err(failure)? > 1024 * 1024 {
            return Err(failure("attribute exceeds numeric element limit"));
        }
        macro_rules! numeric {
            ($t:ty) => {
                attr.read_1d::<$t>()
                    .map_err(failure)?
                    .into_iter()
                    .map(|v| v as f64)
                    .collect()
            };
        }
        let values = match attr.datatype {
            Datatype::FloatingPoint { size: 8, .. } => attr.read_1d::<f64>().map_err(failure)?,
            Datatype::FloatingPoint { size: 4, .. } => numeric!(f32),
            Datatype::FixedPoint { size, signed, .. } => match (size, signed) {
                (1, false) => numeric!(u8),
                (2, false) => numeric!(u16),
                (4, false) => numeric!(u32),
                (8, false) => numeric!(u64),
                (1, true) => numeric!(i8),
                (2, true) => numeric!(i16),
                (4, true) => numeric!(i32),
                (8, true) => numeric!(i64),
                _ => return Err(failure("unsupported numeric attribute width")),
            },
            _ => return Err(failure("expected numeric attribute")),
        };
        Ok((attr.shape, values))
    }
    pub fn root_f64(&self, name: &str) -> DsResult<f64> {
        let (_, values) = self.root_floats(name)?;
        if values.len() != 1 {
            return Err(failure("expected scalar numeric attribute"));
        }
        Ok(values[0])
    }
    pub fn root_f64_matrix(&self, name: &str) -> DsResult<Vec<Vec<f64>>> {
        let (shape, values) = self.root_floats(name)?;
        if shape.len() != 2 || shape[1] == 0 {
            return Err(failure("expected matrix attribute"));
        }
        Ok(values
            .chunks(shape[1] as usize)
            .map(|row| row.to_vec())
            .collect())
    }
    pub fn bytes(&self, name: &str, start: u64, count: u64) -> DsResult<Vec<u8>> {
        let dataset = self.file.dataset(name).map_err(failure)?;
        if dataset.ndim() != 1 {
            return Err(failure("expected byte vector"));
        }
        Self::check_chunks(&dataset, 1)?;
        let selection = Self::selection(&dataset, start, count, 1, None)?;
        match dataset.dtype() {
            Datatype::FixedPoint {
                size: 1,
                signed: false,
                ..
            } => read::<u8>(&dataset, &selection),
            Datatype::FixedPoint {
                size: 1,
                signed: true,
                ..
            } => Ok(read::<i8>(&dataset, &selection)?
                .into_iter()
                .map(|v| {
                    u8::try_from(v).map_err(|_| failure("unsigned dataset conversion loses sign"))
                })
                .collect::<DsResult<Vec<_>>>()?),
            _ => Err(failure("expected one-byte integer dataset")),
        }
    }
    pub fn dataset_shape(&self, name: &str) -> DsResult<Vec<u64>> {
        Ok(self.file.dataset(name).map_err(failure)?.shape().to_vec())
    }
    fn dataset(&self, name: &str, width: u8, rank: usize) -> DsResult<Dataset> {
        let dataset = self.file.dataset(name).map_err(failure)?;
        if dataset.ndim() != rank {
            return Err(failure(format!("{name}: unexpected rank")));
        }
        if !matches!(dataset.dtype(),Datatype::FixedPoint{size,..} if *size==width) {
            return Err(failure(format!(
                "{name}: expected {width}-byte integer datatype"
            )));
        }
        Self::check_chunks(&dataset, width)?;
        Ok(dataset)
    }
    fn check_chunks(dataset: &Dataset, width: u8) -> DsResult<()> {
        let rank = dataset.ndim();
        if let Some(chunks) = dataset.chunks() {
            // Older HDF5 layout messages include a final element-size dimension.
            let mut shape = chunks.as_slice();
            if shape.len() == rank + 1 {
                shape = &shape[..rank];
            }
            let size = shape
                .iter()
                .try_fold(u64::from(width), |p, d| p.checked_mul(u64::from(*d)));
            if size.is_none_or(|n| n > MAX_CHUNK_BYTES) {
                return Err(failure("chunk exceeds 300 MiB"));
            }
        }
        Ok(())
    }
    fn selection(
        dataset: &Dataset,
        start: u64,
        count: u64,
        width: u64,
        columns: Option<u64>,
    ) -> DsResult<SliceInfo> {
        let end = start
            .checked_add(count)
            .ok_or_else(|| failure("selection overflow"))?;
        if start >= dataset.shape()[0] {
            return Err(failure("selection offset exceeds dataset"));
        }
        let end = end.min(dataset.shape()[0]);
        let bytes = (end - start)
            .checked_mul(columns.unwrap_or(1))
            .and_then(|n| n.checked_mul(width));
        if bytes.is_none_or(|n| n > MAX_READ_BYTES) {
            return Err(failure("selection exceeds 64 MiB"));
        }
        let mut selections = vec![SliceInfoElem::Slice {
            start,
            end,
            step: 1,
        }];
        if let Some(columns) = columns {
            if dataset.shape()[1] != columns {
                return Err(failure(format!("expected {columns} matrix columns")));
            }
            selections.push(SliceInfoElem::Slice {
                start: 0,
                end: columns,
                step: 1,
            });
        }
        Ok(SliceInfo { selections })
    }
    pub fn u64_slice(
        &self,
        name: &str,
        start: u64,
        count: u64,
        matrix: bool,
    ) -> DsResult<Vec<u64>> {
        let dataset = self.dataset(name, 8, if matrix { 2 } else { 1 })?;
        let selection = Self::selection(&dataset, start, count, 8, matrix.then_some(3))?;
        if matches!(dataset.dtype(), Datatype::FixedPoint { signed: true, .. }) {
            Ok(read::<i64>(&dataset, &selection)?
                .into_iter()
                .map(|v| {
                    u64::try_from(v).map_err(|_| failure("unsigned dataset conversion loses sign"))
                })
                .collect::<DsResult<Vec<_>>>()?)
        } else {
            read::<u64>(&dataset, &selection)
        }
    }
    pub fn u16_matrix(&self, name: &str, start: u64, count: u64) -> DsResult<Vec<u16>> {
        let dataset = self.dataset(name, 2, 2)?;
        let selection = Self::selection(&dataset, start, count, 2, Some(3))?;
        if matches!(dataset.dtype(), Datatype::FixedPoint { signed: true, .. }) {
            Ok(read::<i16>(&dataset, &selection)?
                .into_iter()
                .map(|v| {
                    u16::try_from(v).map_err(|_| failure("unsigned dataset conversion loses sign"))
                })
                .collect::<DsResult<Vec<_>>>()?)
        } else {
            read::<u16>(&dataset, &selection)
        }
    }
    /// JHDF5 uint64 numeric conversion, including narrower integers in agglomerate files.
    /// JHDF5 rejects sign/fraction/range loss through its transfer-property callback. Root
    /// attributes use H5Aread without that callback and retain the HDF5 clamp behavior.
    pub fn uint64_values(
        &self,
        name: &str,
        start: u64,
        count: u64,
        columns: Option<u64>,
    ) -> DsResult<Vec<u64>> {
        let dataset = self.file.dataset(name).map_err(failure)?;
        if dataset.ndim() != if columns.is_some() { 2 } else { 1 } {
            return Err(failure("unexpected integer table rank"));
        }
        if let Datatype::FloatingPoint { size, .. } = dataset.dtype() {
            Self::check_chunks(&dataset, *size)?;
            let selection = Self::selection(&dataset, start, count, 8, columns)?;
            let values = match size {
                4 => read::<f32>(&dataset, &selection)?
                    .into_iter()
                    .map(f64::from)
                    .collect(),
                8 => read::<f64>(&dataset, &selection)?,
                _ => return Err(failure("unsupported floating point width")),
            };
            return values
                .into_iter()
                .map(|v| {
                    if v.is_finite() && (0. ..18446744073709551616.).contains(&v) && v.fract() == 0.
                    {
                        Ok(v as u64)
                    } else {
                        Err(failure(
                            "unsigned dataset conversion loses fraction, sign or range",
                        ))
                    }
                })
                .collect();
        }
        let Datatype::FixedPoint { size, signed, .. } = dataset.dtype() else {
            return Err(failure("expected numeric datatype"));
        };
        Self::check_chunks(&dataset, *size)?;
        let selection = Self::selection(&dataset, start, count, 8, columns)?;
        macro_rules! unsigned {
            ($t:ty) => {
                read::<$t>(&dataset, &selection)?
                    .into_iter()
                    .map(u64::from)
                    .collect()
            };
        }
        macro_rules! signed {
            ($t:ty) => {
                read::<$t>(&dataset, &selection)?
                    .into_iter()
                    .map(|v| {
                        u64::try_from(v)
                            .map_err(|_| failure("unsigned dataset conversion loses sign"))
                    })
                    .collect::<DsResult<Vec<_>>>()?
            };
        }
        Ok(match (*size, *signed) {
            (1, false) => unsigned!(u8),
            (2, false) => unsigned!(u16),
            (4, false) => unsigned!(u32),
            (8, false) => read::<u64>(&dataset, &selection)?,
            (1, true) => signed!(i8),
            (2, true) => signed!(i16),
            (4, true) => signed!(i32),
            (8, true) => signed!(i64),
            _ => return Err(failure("unsupported integer width")),
        })
    }
    pub fn float32_values(&self, name: &str, start: u64, count: u64) -> DsResult<Vec<f32>> {
        let dataset = self.file.dataset(name).map_err(failure)?;
        if dataset.ndim() != 1 {
            return Err(failure("unexpected float table rank"));
        }
        let size = match dataset.dtype() {
            Datatype::FloatingPoint { size, .. } | Datatype::FixedPoint { size, .. } => *size,
            _ => return Err(failure("expected numeric datatype")),
        };
        Self::check_chunks(&dataset, size)?;
        let selection = Self::selection(&dataset, start, count, 4, None)?;
        match dataset.dtype() {
            Datatype::FloatingPoint { size: 4, .. } => read::<f32>(&dataset, &selection),
            Datatype::FloatingPoint { size: 8, .. } => read::<f64>(&dataset, &selection)?
                .into_iter()
                .map(|v| {
                    let converted = v as f32;
                    if v.is_finite() && (!converted.is_finite() || (v != 0. && converted == 0.)) {
                        Err(failure("float dataset conversion loses range"))
                    } else {
                        Ok(converted)
                    }
                })
                .collect(),
            Datatype::FixedPoint { signed: false, .. } => self
                .uint64_values(name, start, count, None)?
                .into_iter()
                .map(|v| {
                    if integer_fits_float32(v) {
                        Ok(v as f32)
                    } else {
                        Err(failure("float dataset conversion loses integer precision"))
                    }
                })
                .collect(),
            Datatype::FixedPoint {
                size, signed: true, ..
            } => {
                macro_rules! numeric {
                    ($t:ty) => {
                        read::<$t>(&dataset, &selection)?
                            .into_iter()
                            .map(|v| {
                                if integer_fits_float32((v as i64).unsigned_abs()) {
                                    Ok(v as f32)
                                } else {
                                    Err(failure("float dataset conversion loses integer precision"))
                                }
                            })
                            .collect::<DsResult<Vec<_>>>()?
                    };
                }
                Ok(match size {
                    1 => numeric!(i8),
                    2 => numeric!(i16),
                    4 => numeric!(i32),
                    8 => numeric!(i64),
                    _ => return Err(failure("unsupported integer width")),
                })
            }
            _ => Err(failure("unsupported floating point width")),
        }
    }
}
fn read<T: H5Type>(dataset: &Dataset, selection: &SliceInfo) -> DsResult<Vec<T>> {
    Ok(dataset
        .read_slice::<T>(selection)
        .map_err(failure)?
        .into_iter()
        .collect())
}
// Integer→Float32 precision loss is an error under JHDF5's conversion callback.
fn integer_fits_float32(value: u64) -> bool {
    let significant = 64 - value.leading_zeros();
    significant <= 24 || value.trailing_zeros() >= significant - 24
}
