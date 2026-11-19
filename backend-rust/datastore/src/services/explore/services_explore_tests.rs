use serde_json::json;

use super::{
    layer_utils::{
        remove_header_file_names_from_uri_suffix, remove_neuroglancer_prefixes_from_uri,
    },
    neuroglancer,
};

#[test]
fn strips_uri_decorations() {
    assert_eq!(
        remove_header_file_names_from_uri_suffix("s3://b/x/.zarray"),
        "s3://b/x/"
    );
    assert_eq!(
        remove_neuroglancer_prefixes_from_uri("zarr://https://h/x"),
        "https://h/x"
    );
}

#[test]
fn parses_neuroglancer_fragments() {
    let raw = neuroglancer::raw_fragment("https://ng/#!%7B%22layers%22:[]%7D").unwrap();
    assert_eq!(
        neuroglancer::parse_fragment(raw).unwrap()["layers"],
        json!([])
    );
    let twice = "%257B%2522a%2522:%2522x+y%2522%257D";
    assert_eq!(neuroglancer::parse_fragment(twice).unwrap()["a"], "x+y");
    assert_eq!(
        neuroglancer::primary_source_url(&json!([{"url": "zarr://s3://b/x"}])).unwrap(),
        "zarr://s3://b/x"
    );
}
