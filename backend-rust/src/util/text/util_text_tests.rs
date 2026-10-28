use super::normalize_strong;

#[test]
fn normalize_strong_matches_text_utils() {
    assert_eq!(normalize_strong("Jürgen").as_deref(), Some("Juergen"));
    assert_eq!(normalize_strong("Ærø Øst").as_deref(), Some("Aeroe Oest"));
    assert_eq!(normalize_strong("a.b@c!").as_deref(), Some("abc"));
    assert_eq!(
        normalize_strong("my org-1_x").as_deref(),
        Some("my org-1_x")
    );
    assert_eq!(normalize_strong("日本"), None);
    assert_eq!(normalize_strong(""), None);
}
