//! The subset of `ucar.ma2.Array` used by the readers, plus Scala `MultiArrayUtils` and
//! `BytesConverter`.
//!
//! Storage is a flat byte buffer of fixed-size elements in little-endian order (the readers convert
//! from the header byte order when typing a chunk), so element copies are byte copies and the
//! final `BytesConverter.toByteArray(.., LITTLE_ENDIAN)` is the storage itself.

use std::sync::Arc;

use super::data_type::{ArrayDataType, JavaNumber};
use crate::error::{DsError, DsResult};

/// `ucar.ma2.DataType` of an array (unsigned array types map to the signed Java storage types).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MaDataType {
    Byte,
    Short,
    Int,
    Long,
    Float,
    Double,
    Boolean,
}

impl MaDataType {
    /// `DataType.getSize`.
    pub fn size(self) -> usize {
        match self {
            Self::Byte | Self::Boolean => 1,
            Self::Short => 2,
            Self::Int | Self::Float => 4,
            Self::Long | Self::Double => 8,
        }
    }

    /// The storage type `ChunkTyper.createFromHeader` / `MultiArrayUtils.createDataBuffer` use.
    pub fn for_array_data_type(data_type: ArrayDataType) -> Self {
        match data_type {
            ArrayDataType::I1 | ArrayDataType::U1 => Self::Byte,
            ArrayDataType::I2 | ArrayDataType::U2 => Self::Short,
            ArrayDataType::I4 | ArrayDataType::U4 => Self::Int,
            ArrayDataType::I8 | ArrayDataType::U8 => Self::Long,
            ArrayDataType::F4 => Self::Float,
            ArrayDataType::F8 => Self::Double,
            ArrayDataType::Bool => Self::Boolean,
        }
    }

    /// Java primitive name, for messages.
    pub fn name(self) -> &'static str {
        match self {
            Self::Byte => "byte",
            Self::Short => "short",
            Self::Int => "int",
            Self::Long => "long",
            Self::Float => "float",
            Self::Double => "double",
            Self::Boolean => "boolean",
        }
    }
}

/// An n-dimensional view (shape + element strides + offset) over shared element storage.
#[derive(Debug, Clone, PartialEq)]
pub struct NdArray {
    data_type: MaDataType,
    shape: Vec<usize>,
    strides: Vec<usize>,
    offset: usize,
    storage: Arc<Vec<u8>>,
}

fn c_order_strides(shape: &[usize]) -> Vec<usize> {
    let mut strides = vec![1usize; shape.len()];
    for d in (0..shape.len().saturating_sub(1)).rev() {
        strides[d] = strides[d + 1] * shape[d + 1];
    }
    strides
}

fn illegal_argument(message: impl Into<String>) -> DsError {
    let message = message.into();
    DsError {
        exception: Some(format!("java.lang.IllegalArgumentException: {message}")),
        ..DsError::failure(message)
    }
}

/// Number of elements of `shape` (`Index.computeSize`), `None` on overflow.
pub fn element_count(shape: &[usize]) -> Option<usize> {
    shape.iter().try_fold(1usize, |acc, &d| acc.checked_mul(d))
}

impl NdArray {
    /// `Array.factory(dataType, shape, storage)`: a C-order array over existing storage. The
    /// storage may be longer than needed (extra bytes are ignored, as in ucar); shorter storage
    /// is an error.
    pub fn from_storage(
        data_type: MaDataType,
        shape: Vec<usize>,
        storage: Arc<Vec<u8>>,
    ) -> DsResult<Self> {
        let needed = element_count(&shape)
            .and_then(|n| n.checked_mul(data_type.size()))
            .ok_or_else(|| illegal_argument("array size overflow"))?;
        if storage.len() < needed {
            return Err(DsError::failure(format!(
                "Storage of {} bytes is too small for shape {:?} of type {}",
                storage.len(),
                shape,
                data_type.name()
            )));
        }
        let strides = c_order_strides(&shape);
        Ok(Self {
            data_type,
            shape,
            strides,
            offset: 0,
            storage,
        })
    }

    /// `Array.factory(dataType, shape)`: zero-initialized.
    pub fn zeros(data_type: MaDataType, shape: Vec<usize>) -> DsResult<Self> {
        let len = element_count(&shape)
            .and_then(|n| n.checked_mul(data_type.size()))
            .ok_or_else(|| illegal_argument("array size overflow"))?;
        Self::from_storage(data_type, shape, Arc::new(vec![0u8; len]))
    }

    pub fn data_type(&self) -> MaDataType {
        self.data_type
    }

    pub fn shape(&self) -> &[usize] {
        &self.shape
    }

    pub fn rank(&self) -> usize {
        self.shape.len()
    }

    pub fn size(&self) -> usize {
        element_count(&self.shape).unwrap_or(usize::MAX)
    }

    /// `getSizeBytes` (logical size).
    pub fn size_bytes(&self) -> usize {
        self.size().saturating_mul(self.data_type.size())
    }

    /// `getStorage`: the whole backing buffer, independent of this view.
    pub fn storage(&self) -> &Arc<Vec<u8>> {
        &self.storage
    }

    pub fn into_storage(self) -> Arc<Vec<u8>> {
        self.storage
    }

    /// `permute(dims)`: new dimension k is old dimension `dims[k]`.
    pub fn permute(&self, dims: &[usize]) -> DsResult<Self> {
        if dims.len() != self.rank() {
            return Err(illegal_argument("wrong rank"));
        }
        let mut seen = vec![false; dims.len()];
        for &d in dims {
            if d >= dims.len() || seen[d] {
                return Err(illegal_argument("duplicate dimension or out of range"));
            }
            seen[d] = true;
        }
        Ok(Self {
            data_type: self.data_type,
            shape: dims.iter().map(|&d| self.shape[d]).collect(),
            strides: dims.iter().map(|&d| self.strides[d]).collect(),
            offset: self.offset,
            storage: Arc::clone(&self.storage),
        })
    }

    /// `transpose(dim1, dim2)`.
    pub fn transpose(&self, dim1: usize, dim2: usize) -> DsResult<Self> {
        let mut dims: Vec<usize> = (0..self.rank()).collect();
        if dim1 >= dims.len() || dim2 >= dims.len() {
            return Err(illegal_argument("dimension out of range"));
        }
        dims.swap(dim1, dim2);
        self.permute(&dims)
    }

    /// `copy()`: a new C-order array with this view's logical contents.
    pub fn copy(&self) -> DsResult<Self> {
        let mut target = Self::zeros(self.data_type, self.shape.clone())?;
        let zero = vec![0i64; self.rank()];
        copy_range(&zero, self, &mut target)?;
        Ok(target)
    }

    fn element_offset(&self, index: &[usize]) -> usize {
        self.offset
            + index
                .iter()
                .zip(&self.strides)
                .map(|(i, s)| i * s)
                .sum::<usize>()
    }

    /// Element bytes at a logical index (little-endian).
    pub fn element_bytes(&self, index: &[usize]) -> &[u8] {
        let size = self.data_type.size();
        let start = self.element_offset(index) * size;
        &self.storage[start..start + size]
    }
}

/// Scala `MultiArrayUtils.copyRange(offset, source, target)`: copies the overlap of `source`
/// displaced by `offset` into `target` (offset > 0: source starts inside, < 0: target starts
/// inside). No overlap in some dimension copies nothing.
pub fn copy_range(offset: &[i64], source: &NdArray, target: &mut NdArray) -> DsResult<()> {
    let rank = offset.len();
    if source.rank() != rank || target.rank() != rank {
        return Err(DsError::failure(format!(
            "Rank mismatch: offset {rank}, source {}, target {}",
            source.rank(),
            target.rank()
        )));
    }
    if source.data_type.size() != target.data_type.size() {
        return Err(DsError::failure("Element type mismatch in copyRange"));
    }
    let mut source_first = vec![0usize; rank];
    let mut target_first = vec![0usize; rank];
    let mut lengths = vec![0usize; rank];
    for d in 0..rank {
        let (sf, tf) = if offset[d] >= 0 {
            (offset[d], 0i64)
        } else {
            (0i64, -offset[d])
        };
        let max_steps = (source.shape[d] as i64 - sf).min(target.shape[d] as i64 - tf);
        if max_steps <= 0 {
            return Ok(());
        }
        source_first[d] = sf as usize;
        target_first[d] = tf as usize;
        lengths[d] = max_steps as usize;
    }
    if rank == 0 {
        return Ok(());
    }
    let size = source.data_type.size();
    let last = rank - 1;
    let contiguous = (source.strides[last] == 1 || source.shape[last] < 2)
        && (target.strides[last] == 1 || target.shape[last] < 2);
    let target_storage = Arc::make_mut(&mut target.storage);
    let mut counter = vec![0usize; rank];
    let mut source_index = vec![0usize; rank];
    let mut target_index = vec![0usize; rank];
    loop {
        for d in 0..rank {
            source_index[d] = source_first[d] + counter[d];
            target_index[d] = target_first[d] + counter[d];
        }
        if contiguous {
            let s = source.element_offset(&source_index) * size;
            let t = (target.offset
                + target_index
                    .iter()
                    .zip(&target.strides)
                    .map(|(i, st)| i * st)
                    .sum::<usize>())
                * size;
            let n = lengths[last] * size;
            target_storage[t..t + n].copy_from_slice(&source.storage[s..s + n]);
        } else {
            for i in 0..lengths[last] {
                source_index[last] = source_first[last] + i;
                target_index[last] = target_first[last] + i;
                let s = source.element_offset(&source_index) * size;
                let t = (target.offset
                    + target_index
                        .iter()
                        .zip(&target.strides)
                        .map(|(i, st)| i * st)
                        .sum::<usize>())
                    * size;
                target_storage[t..t + size].copy_from_slice(&source.storage[s..s + size]);
            }
        }
        // advance the outer dimensions (last dimension is handled as one run)
        let mut d = last;
        loop {
            if d == 0 {
                return Ok(());
            }
            d -= 1;
            counter[d] += 1;
            if counter[d] < lengths[d] {
                break;
            }
            counter[d] = 0;
        }
    }
}

/// Encodes `count` copies of a typed fill value (Scala `MultiArrayUtils.createFilledArray`).
pub fn filled_storage(
    data_type: MaDataType,
    count: usize,
    fill_number: JavaNumber,
    fill_boolean: bool,
) -> Vec<u8> {
    let element: Vec<u8> = match data_type {
        MaDataType::Double => fill_number.double_value().to_le_bytes().to_vec(),
        MaDataType::Float => fill_number.float_value().to_le_bytes().to_vec(),
        MaDataType::Long => fill_number.long_value().to_le_bytes().to_vec(),
        MaDataType::Int => fill_number.int_value().to_le_bytes().to_vec(),
        MaDataType::Short => fill_number.short_value().to_le_bytes().to_vec(),
        MaDataType::Byte => fill_number.byte_value().to_le_bytes().to_vec(),
        MaDataType::Boolean => vec![u8::from(fill_boolean)],
    };
    if element.iter().all(|&b| b == element[0]) {
        return vec![element[0]; count * element.len()];
    }
    element.repeat(count)
}

/// Scala `MultiArrayUtils.createFilledArray`.
pub fn create_filled_array(
    data_type: MaDataType,
    shape: Vec<usize>,
    fill_number: JavaNumber,
    fill_boolean: bool,
) -> DsResult<NdArray> {
    let count = element_count(&shape).ok_or_else(|| illegal_argument("array size overflow"))?;
    let storage = filled_storage(data_type, count, fill_number, fill_boolean);
    NdArray::from_storage(data_type, shape, Arc::new(storage))
}

/// Scala `MultiArrayUtils.createEmpty` (`bool` is a `MatchError` in Scala).
pub fn create_empty(data_type: ArrayDataType, rank: usize) -> DsResult<NdArray> {
    if data_type == ArrayDataType::Bool {
        return Err(match_error("bool"));
    }
    NdArray::zeros(MaDataType::for_array_data_type(data_type), vec![0; rank])
}

pub(crate) fn match_error(value: &str) -> DsError {
    let message = format!("{value} (of class scala.Enumeration$Val)");
    DsError {
        exception: Some(format!("scala.MatchError: {message}")),
        ..DsError::failure(message)
    }
}

/// Scala `MultiArrayUtils.toLongArray` (over the whole storage).
pub fn to_long_array(array: &NdArray) -> DsResult<Vec<i64>> {
    let storage = array.storage();
    match array.data_type() {
        MaDataType::Long => Ok(storage
            .as_chunks::<8>()
            .0
            .iter()
            .map(|c| i64::from_le_bytes(*c))
            .collect()),
        MaDataType::Int => Ok(storage
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| i64::from(i32::from_le_bytes(*c)))
            .collect()),
        _ => Err(DsError::failure(
            "Cannot convert MultiArray to LongArray: unsupported data type.",
        )),
    }
}

/// Scala `BytesConverter.toByteArray(multiArray, dataType, LITTLE_ENDIAN)`: the storage bytes
/// (already little-endian). Boolean storage cannot be cast to `byte[]` in Scala.
pub fn to_byte_array(array: &NdArray) -> DsResult<Arc<Vec<u8>>> {
    if array.data_type() == MaDataType::Boolean {
        let message = "class [Z cannot be cast to class [B ([Z and [B are in module java.base of loader 'bootstrap')";
        return Err(DsError {
            exception: Some(format!("java.lang.ClassCastException: {message}")),
            ..DsError::failure(message)
        });
    }
    Ok(Arc::clone(array.storage()))
}

/// Scala `MultiArrayUtils.axisOrderXYZViewF`: a view in wk axis order, F layout.
pub fn axis_order_xyz_view_f(
    source: &NdArray,
    full_axis_order: &super::axis_order::FullAxisOrder,
    source_is_f: bool,
) -> DsResult<NdArray> {
    let permutation = if source_is_f {
        full_axis_order.physical_f_to_wk_f_permutation()
    } else {
        full_axis_order.physical_c_to_wk_f_permutation()
    };
    source.permute(&permutation)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes_array(shape: Vec<usize>, values: Vec<u8>) -> NdArray {
        NdArray::from_storage(MaDataType::Byte, shape, Arc::new(values)).unwrap()
    }

    #[test]
    fn copy_range_offsets_like_scala_doc() {
        let source = bytes_array(vec![9], (1..=9).collect());
        let mut target = bytes_array(vec![3], vec![0xff; 3]);
        copy_range(&[3], &source, &mut target).unwrap();
        assert_eq!(target.storage().as_slice(), &[4, 5, 6]);
        let mut target = bytes_array(vec![3], vec![0xff; 3]);
        copy_range(&[-2], &source, &mut target).unwrap();
        assert_eq!(target.storage().as_slice(), &[0xff, 0xff, 1]);
        let mut target = bytes_array(vec![3], vec![0xff; 3]);
        copy_range(&[20], &source, &mut target).unwrap();
        assert_eq!(target.storage().as_slice(), &[0xff; 3]);
    }

    #[test]
    fn copy_range_2d_and_permuted_source() {
        // source 2x3 C order: [[0,1,2],[3,4,5]]
        let source = bytes_array(vec![2, 3], (0..6).collect());
        let transposed = source.permute(&[1, 0]).unwrap(); // 3x2: [[0,3],[1,4],[2,5]]
        let mut target = bytes_array(vec![2, 2], vec![9; 4]);
        copy_range(&[1, 0], &transposed, &mut target).unwrap();
        assert_eq!(target.storage().as_slice(), &[1, 4, 2, 5]);
        let copied = transposed.copy().unwrap();
        assert_eq!(copied.storage().as_slice(), &[0, 3, 1, 4, 2, 5]);
        assert!(source.permute(&[0, 0]).is_err());
    }

    #[test]
    fn filled_arrays_and_conversions() {
        let a = create_filled_array(MaDataType::Short, vec![2], JavaNumber::Long(0x0102), false)
            .unwrap();
        assert_eq!(a.storage().as_slice(), &[2, 1, 2, 1]);
        let b =
            create_filled_array(MaDataType::Boolean, vec![3], JavaNumber::Long(0), true).unwrap();
        assert_eq!(b.storage().as_slice(), &[1, 1, 1]);
        assert!(to_byte_array(&b).is_err());
        let i = NdArray::from_storage(
            MaDataType::Int,
            vec![2],
            Arc::new(vec![0xff, 0xff, 0xff, 0xff, 1, 0, 0, 0]),
        )
        .unwrap();
        assert_eq!(to_long_array(&i).unwrap(), vec![-1, 1]);
        assert!(to_long_array(&a).is_err());
        assert_eq!(
            create_empty(ArrayDataType::U2, 3).unwrap().shape(),
            &[0, 0, 0]
        );
        assert!(create_empty(ArrayDataType::Bool, 3).is_err());
    }
}
