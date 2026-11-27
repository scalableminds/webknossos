use super::*;
use crate::{
    datasource::{LayerKind, MagLocator},
    enums::{DataFormat, ElementClass, LengthUnit},
    geometry::{BoundingBox, Vec3Double},
};

fn layer(name: &str, size: i32, mags: Vec<MagLocator>) -> StaticLayer {
    StaticLayer {
        name: name.to_owned(),
        data_format: DataFormat::Zarr,
        bounding_box: BoundingBox::new(Vec3Int::new(0, 0, 0), size, size, size),
        element_class: ElementClass::Uint8,
        mags,
        default_view_configuration: None,
        admin_view_configuration: None,
        coordinate_transformations: None,
        additional_axes: None,
        attachments: None,
        kind: LayerKind::Color,
    }
}

#[test]
fn renames_duplicate_layers() {
    let l = |n: &str| layer(n, 1, vec![]);
    let names: Vec<String> = make_layer_names_unique(vec![l("a"), l("a"), l("a_2"), l("b")])
        .into_iter()
        .map(|l| l.name)
        .collect();
    assert_eq!(names, ["a", "a_2", "a_2_2", "b"]);
}

#[test]
fn unifies_voxel_sizes_by_powers_of_two() {
    let mag = |m: [i32; 3]| MagLocator::new(Vec3Int::new(m[0], m[1], m[2]));
    let l = |name: &str, mags: Vec<MagLocator>| layer(name, 10, mags);
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
        error.last().unwrap(),
        "Could not extract common voxel size from layers"
    );
    // Different units are compared in nanometers.
    let micrometer = VoxelSize {
        factor: Vec3Double::new(0.008, 0.008, 0.008),
        unit: LengthUnit::Micrometer,
    };
    let (_, base) = adapt_layers_and_voxel_size(
        vec![
            (l("a", vec![mag([1, 1, 1])]), v(4.0)),
            (l("b", vec![mag([2, 2, 2])]), micrometer),
        ],
        None,
    )
    .unwrap();
    assert_eq!(base, v(4.0));
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
