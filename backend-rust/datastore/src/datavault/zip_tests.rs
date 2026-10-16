
use super::*;

fn sentinel_entry() -> Entry {
    Entry {
        offset: u64::from(u32::MAX),
        compressed: u64::from(u32::MAX),
        size: u64::from(u32::MAX),
        method: 0,
        name: "file".into(),
    }
}

#[test]
fn zip64_conditional_fields_and_unknown_tags() {
    // Only sentinel fields occur, in size/compressed/offset order, after unrelated tags.
    for mask in 1..8 {
        let mut entry = sentinel_entry();
        let mut extra = vec![0x99, 0, 3, 0, 1, 2, 3, 1, 0, 0, 0];
        let values = [
            (&mut entry.size, 1),
            (&mut entry.compressed, 2),
            (&mut entry.offset, 4),
        ];
        for (value, bit) in values {
            if mask & bit != 0 {
                extra.extend_from_slice(&(100u64 + bit).to_le_bytes());
            } else {
                *value = 7;
            }
        }
        let length = (extra.len() - 11) as u16;
        extra[9..11].copy_from_slice(&length.to_le_bytes());
        extend_zip64(&mut entry, &extra).unwrap();
        assert_eq!(entry.size, if mask & 1 != 0 { 101 } else { 7 });
        assert_eq!(entry.compressed, if mask & 2 != 0 { 102 } else { 7 });
        assert_eq!(entry.offset, if mask & 4 != 0 { 104 } else { 7 });
    }
}

#[test]
fn zip64_rejects_signed_overflow_and_cross_tag_reads() {
    assert!(u64_at(&u64::MAX.to_le_bytes(), 0).is_err());
    assert!(checked_add(i64::MAX as u64, 1).is_err());
    let mut extra = vec![1, 0, 8, 0];
    extra.extend_from_slice(&10u64.to_le_bytes());
    // A later unrelated tag must not supply the missing compressed-size field.
    extra.extend_from_slice(&[2, 0, 16, 0]);
    extra.extend_from_slice(&[0; 16]);
    assert!(extend_zip64(&mut sentinel_entry(), &extra).is_err());
}

#[test]
fn normalized_duplicate_names_keep_last_entry() {
    let mut bytes = Vec::new();
    for (name, size) in [("/same/", 1u32), ("same", 2)] {
        let mut header = vec![0; 46];
        header[..4].copy_from_slice(&CENTRAL.to_le_bytes());
        header[24..28].copy_from_slice(&size.to_le_bytes());
        header[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
        bytes.extend(header);
        bytes.extend_from_slice(name.as_bytes());
    }
    let directory = parse_directory(&bytes).unwrap();
    assert_eq!(directory.entries.len(), 1);
    assert_eq!(directory.entries[directory.by_name["same"]].size, 2);
}
