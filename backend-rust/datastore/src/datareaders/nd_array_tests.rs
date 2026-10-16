
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
    let a =
        create_filled_array(MaDataType::Short, vec![2], JavaNumber::Long(0x0102), false).unwrap();
    assert_eq!(a.storage().as_slice(), &[2, 1, 2, 1]);
    let b = create_filled_array(MaDataType::Boolean, vec![3], JavaNumber::Long(0), true).unwrap();
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
