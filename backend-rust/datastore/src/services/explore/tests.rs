
use super::*;

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

#[test]
fn renames_duplicate_layers() {
    let l = |n: &str| {
        layer(
            n,
            DataFormat::Zarr,
            BoundingBox::new(Vec3Int::new(0, 0, 0), 1, 1, 1),
            ElementClass::Uint8,
            vec![],
            false,
        )
    };
    let names: Vec<String> = make_layer_names_unique(vec![l("a"), l("a"), l("a_2"), l("b")])
        .into_iter()
        .map(|l| l.name)
        .collect();
    assert_eq!(names, ["a", "a_2", "a_2_2", "b"]);
}

#[test]
fn unifies_voxel_sizes_by_powers_of_two() {
    let mag = |m: [i32; 3]| MagLocator::new(Vec3Int::new(m[0], m[1], m[2]));
    let l = |name: &str, mags: Vec<MagLocator>| StaticLayer {
        mags,
        ..layer(
            name,
            DataFormat::Zarr,
            BoundingBox::new(Vec3Int::new(0, 0, 0), 10, 10, 10),
            ElementClass::Uint8,
            vec![],
            false,
        )
    };
    let v = |x: f64| VoxelSize::from_factor_with_default_unit(Vec3Double::new(x, x, x));
    let (layers, base) = adapt_layers_and_voxel_size(
        vec![
            (l("fine", vec![mag([1, 1, 1])]), v(4.0)),
            (l("coarse", vec![mag([1, 1, 1])]), v(8.0)),
        ],
        None,
    )
    .unwrap();
    assert_eq!(base, v(4.0));
    assert_eq!(layers[1].mags[0].mag, Vec3Int::new(2, 2, 2));
    assert_eq!(layers[1].bounding_box.width, 20);
    let error = adapt_layers_and_voxel_size(
        vec![
            (l("x", vec![mag([1, 1, 1])]), v(4.0)),
            (l("y", vec![mag([1, 1, 1])]), v(12.0)),
        ],
        None,
    )
    .unwrap_err();
    assert_eq!(
        error.message,
        "Could not extract common voxel size from layers"
    );
    // A power-of-two compatible preferred voxel size becomes the base (no transformation).
    let (layers, base) =
        adapt_layers_and_voxel_size(vec![(l("x", vec![mag([1, 1, 1])]), v(4.0))], Some(v(2.0)))
            .unwrap();
    assert_eq!(base, v(2.0));
    assert_eq!(layers[0].mags[0].mag, Vec3Int::new(2, 2, 2));
    assert!(layers[0].coordinate_transformations.is_none());
    // Otherwise the found size is kept and scaled to the preferred one.
    let (layers, base) =
        adapt_layers_and_voxel_size(vec![(l("x", vec![mag([1, 1, 1])]), v(4.0))], Some(v(3.0)))
            .unwrap();
    assert_eq!(base, v(4.0));
    let matrix = layers[0].coordinate_transformations.as_ref().unwrap()[0]
        .matrix
        .clone()
        .unwrap();
    assert!((matrix[0][0] - 4.0 / 3.0).abs() < 1e-12);
}
