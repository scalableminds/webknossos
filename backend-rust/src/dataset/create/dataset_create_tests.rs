use super::*;

#[test]
fn directory_names_follow_text_utils() {
    let id = ObjectId::dummy();
    assert_eq!(
        generate_directory_name("Größe test/1", &id),
        "Groesse test1-000000000000000000000000"
    );
    assert_eq!(
        generate_directory_name("§$%", &id),
        "000000000000000000000000"
    );
    assert!(validate_dataset_name("ok_name-1.x").is_ok());
    assert!(validate_dataset_name(".hidden").is_err());
    assert!(validate_dataset_name("ab").is_err());
    assert!(validate_dataset_name("with space").is_err());
    assert_eq!(random_id(12).unwrap().len(), 16);
}
