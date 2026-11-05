use super::*;

#[test]
fn reads_from_the_start_and_ignores_the_rest() {
    let bytes = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0xff];
    assert_eq!(u16_le(&bytes), 0x0201);
    assert_eq!(u16_be(&bytes), 0x0102);
    assert_eq!(u32_le(&bytes), 0x0403_0201);
    assert_eq!(u32_be(&bytes), 0x0102_0304);
    assert_eq!(u64_le(&bytes), 0x0807_0605_0403_0201);
    assert_eq!(u64_be(&bytes), 0x0102_0304_0506_0708);
    assert_eq!(i16_be(&[0xff, 0xfe]), -2);
    assert_eq!(i32_le(&(-7i32).to_le_bytes()), -7);
    assert_eq!(i64_le(&(-7i64).to_le_bytes()), -7);
    assert_eq!(f32_le(&1.5f32.to_le_bytes()), 1.5);
    assert_eq!(array::<3>(&bytes[6..]), [0x07, 0x08, 0xff]);
}

#[test]
#[should_panic(expected = "shorter than the value")]
fn short_slices_panic() {
    let _ = u32_le(&[1, 2, 3]);
}
