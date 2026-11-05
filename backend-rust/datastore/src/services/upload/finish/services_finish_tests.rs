use super::{
    filesystem::{common_prefix, find_common_root_directory},
    naming::{generate_object_id, normalize_strong_rendered},
};
use std::path::PathBuf;

fn p(s: &str) -> PathBuf {
    PathBuf::from(s)
}

#[test]
fn finds_common_roots_like_scala() {
    let boundaries = vec!["color".to_owned(), "segmentation".to_owned()];
    assert_eq!(
        find_common_root_directory(&[p("ds/color/1/a"), p("ds/color/1/b")], &boundaries),
        p("ds")
    );
    assert_eq!(
        find_common_root_directory(&[p("ds/x/a"), p("ds/y/b")], &boundaries),
        p("ds")
    );
    assert_eq!(
        find_common_root_directory(&[p("color/1/a"), p("color/2/b")], &boundaries),
        p("")
    );
    assert_eq!(
        find_common_root_directory(&[p("ds/file.txt")], &boundaries),
        p("ds")
    );
    assert_eq!(
        find_common_root_directory(&[p("file.txt")], &boundaries),
        p("")
    );
    assert_eq!(common_prefix(&[p("/a/b/c"), p("/a/b/d")]), p("/a/b"));
}

#[test]
fn renders_normalize_strong_options() {
    assert_eq!(
        normalize_strong_rendered("Mesh Ü-1.hdf5"),
        "Some(Mesh Ue-1hdf5)"
    );
    assert_eq!(normalize_strong_rendered("..."), "None");
}

#[test]
fn generates_object_ids() {
    let a = generate_object_id();
    let b = generate_object_id();
    assert_eq!(a.len(), 24);
    assert_ne!(a, b);
    assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
}
