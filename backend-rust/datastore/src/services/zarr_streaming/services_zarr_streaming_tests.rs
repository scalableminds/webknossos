use super::*;

fn axis(name: &str, index: i32, bounds: [i32; 2]) -> AdditionalAxis {
    AdditionalAxis {
        name: name.into(),
        bounds: bounds.to_vec(),
        index,
    }
}

#[test]
fn parses_coordinates_like_scala() {
    assert_eq!(
        parse_dot_coordinates("0.1.2.3", &[]).unwrap(),
        (1, 2, 3, None)
    );
    // Java `split` drops trailing empty strings.
    assert_eq!(
        parse_dot_coordinates("0.1.2.3..", &[]).unwrap(),
        (1, 2, 3, None)
    );
    let axes = [axis("t", 1, [0, 5])];
    let (x, y, z, extra) = parse_dot_coordinates("0.4.1.2.3", &axes).unwrap();
    assert_eq!((x, y, z), (1, 2, 3));
    assert_eq!(
        extra.unwrap(),
        [RequestedAdditionalCoordinate {
            name: "t".into(),
            value: 4,
            length: None
        }]
    );
    assert_eq!(
        parse_dot_coordinates("1.1.2.3", &[]).unwrap_err().message,
        INVALID_FIRST_CHUNK_COORD
    );
    assert_eq!(
        parse_dot_coordinates("0.1.2", &[]).unwrap_err().message,
        NOT_ENOUGH_COORDINATES
    );
    assert_eq!(
        parse_dot_coordinates("0.1.2.3", &axes).unwrap_err().message,
        INVALID_ADDITIONAL_COORDINATES
    );
    assert!(parse_dot_coordinates("0.a.2.3", &[]).is_err());
    assert!(parse_dot_coordinates("...", &[]).is_err());
}

#[test]
fn reorders_axes_from_one() {
    let axes = reorder_additional_axes(&[axis("b", 7, [0, 2]), axis("a", 3, [0, 3])]);
    assert_eq!(
        axes.iter()
            .map(|a| (a.name.as_str(), a.index))
            .collect::<Vec<_>>(),
        [("a", 1), ("b", 2)]
    );
}

#[test]
fn directory_listing_escapes_entries() {
    let html = directory_html("Datastore", "id/<x>", &[".zgroup".into(), "a&b".into()]);
    assert!(html.contains("WEBKNOSSOS Datastore “id/&lt;x&gt;” folder."));
    assert!(html.contains("<li><a href=\"a&amp;b\">a&amp;b</a></li>"));
    assert!(html.starts_with("<!DOCTYPE html>"));
}

#[test]
fn directory_listing_matches_captured_scala_bytes() {
    // GET /data/zarr3/<id>/color/1 from the Scala datastore (live differential run 2026-10-17).
    let scala = include_str!("../../../tests/fixtures/zarr_listing/scala_zarr3_mag_dir.html");
    let html = directory_html(
        "Datastore",
        "000000000000000000000004/color/1",
        &["zarr.json".into()],
    );
    assert_eq!(html, scala);
}

// Port of Scala `ZarrStreamingAdditionalAxesTestSuite`: the served .zarray/zarr.json of layers and
// volume tracings with additional axes must describe arrays whose chunk keys are accepted by
// `parse_dot_coordinates` (as used by the raw cube routes).

use crate::datareaders::zarr::ZarrHeader;
use crate::datareaders::zarr::ngff::{NgffMetadata, NgffMetadataV0_5};
use crate::models::{LengthUnit, Vec3Double, VoxelSize};

fn additional_axes_bbox() -> BoundingBox {
    BoundingBox::new(Vec3Int::new(64, 64, 32), 1024, 1024, 512)
}

/// Like a volume tracing inheriting a singleton t axis from its dataset.
fn singleton_t_axis() -> Vec<AdditionalAxis> {
    vec![axis("t", 0, [0, 1])]
}

/// Axes whose listing order differs from their index order.
fn unordered_axes() -> Vec<AdditionalAxis> {
    vec![axis("t", 2, [0, 5]), axis("angle", 1, [0, 3])]
}

fn ones() -> Vec3Int {
    Vec3Int::new(1, 1, 1)
}

fn zarr3_header(axes: &[AdditionalAxis]) -> Value {
    zarr3_array_header_json(ElementClass::Uint32, &additional_axes_bbox(), axes, ones())
}

fn i64s(value: &Value) -> Vec<i64> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect()
}

fn strs(value: &Value) -> Vec<&str> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect()
}

#[test]
fn zarr2_header_includes_singleton_additional_axis() {
    let header = ZarrHeader::for_array(
        ElementClass::Uint32,
        &additional_axes_bbox(),
        &singleton_t_axis(),
        ones(),
    );
    assert_eq!(header.shape, [1, 1, 1088, 1088, 544]);
    assert_eq!(header.chunks, [1, 1, 32, 32, 32]);
}

#[test]
fn zarr2_header_orders_additional_axes_by_index() {
    let header = ZarrHeader::for_array(
        ElementClass::Uint32,
        &additional_axes_bbox(),
        &unordered_axes(),
        Vec3Int::new(2, 2, 2),
    );
    assert_eq!(header.shape, [1, 3, 5, 544, 544, 272]);
    assert_eq!(header.chunks, [1, 1, 1, 32, 32, 32]);
}

#[test]
fn zarr2_header_keeps_4d_layout_without_additional_axes() {
    let header = ZarrHeader::for_array(ElementClass::Uint32, &additional_axes_bbox(), &[], ones());
    assert_eq!(header.shape, [1, 1088, 1088, 544]);
    assert_eq!(header.chunks, [1, 32, 32, 32]);
}

#[test]
fn zarr3_header_includes_singleton_additional_axis() {
    let header = zarr3_header(&singleton_t_axis());
    // Exclusive upper bound: a `t: [0, 1]` axis has size 1 (not `highestValue` = 0).
    assert_eq!(i64s(&header["shape"]), [1, 1, 1088, 1088, 544]);
    assert_eq!(
        i64s(&header["chunk_grid"]["configuration"]["chunk_shape"]),
        [1, 1, 32, 32, 32]
    );
    assert_eq!(strs(&header["dimension_names"]), ["c", "t", "x", "y", "z"]);
    assert_eq!(header["codecs"][0]["name"], "transpose");
    assert_eq!(
        i64s(&header["codecs"][0]["configuration"]["order"]),
        [4, 3, 2, 1, 0]
    );
}

#[test]
fn zarr3_header_orders_additional_axes_by_index() {
    let header = zarr3_header(&unordered_axes());
    assert_eq!(i64s(&header["shape"]), [1, 3, 5, 1088, 1088, 544]);
    assert_eq!(
        strs(&header["dimension_names"]),
        ["c", "angle", "t", "x", "y", "z"]
    );
}

fn ngff_voxel_size() -> VoxelSize {
    VoxelSize {
        factor: Vec3Double::new(11.0, 11.0, 24.0),
        unit: LengthUnit::Nanometer,
    }
}

fn ngff_mags() -> [Vec3Int; 2] {
    [ones(), Vec3Int::new(2, 2, 1)]
}

#[test]
fn ngff_v0_4_matches_array_rank() {
    let header = ZarrHeader::for_array(
        ElementClass::Uint32,
        &additional_axes_bbox(),
        &singleton_t_axis(),
        ones(),
    );
    let rank = header.shape.len();
    let axes = singleton_t_axis();
    let metadata = NgffMetadata::from_name_voxel_size_and_mags(
        "layer",
        &ngff_voxel_size(),
        &ngff_mags(),
        Some(&axes),
    );
    let item = &metadata.multiscales[0];
    assert_eq!(item.axes.len(), rank);
    assert!(
        item.datasets
            .iter()
            .flat_map(|d| &d.coordinate_transformations)
            .all(|t| t.scale.as_ref().is_some_and(|s| s.len() == rank))
    );
    assert_eq!(
        item.datasets[1].coordinate_transformations[0].scale,
        Some(vec![1.0, 1.0, 22.0, 22.0, 24.0])
    );
}

#[test]
fn ngff_v0_5_matches_array_rank_and_dimension_names() {
    let header = zarr3_header(&unordered_axes());
    let dimension_names = strs(&header["dimension_names"]);
    let rank = dimension_names.len();
    let axes = unordered_axes();
    let metadata = NgffMetadataV0_5::from_name_voxel_size_and_mags(
        "layer",
        &ngff_voxel_size(),
        &ngff_mags(),
        Some(&axes),
        "0.5",
    );
    let item = &metadata.multiscales[0];
    assert_eq!(item.axes.len(), rank);
    assert!(
        item.datasets
            .iter()
            .flat_map(|d| &d.coordinate_transformations)
            .all(|t| t.scale.as_ref().is_some_and(|s| s.len() == rank))
    );
    // Axis names must match the zarr 3 dimension_names
    assert_eq!(
        item.axes
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>(),
        dimension_names
    );
    // Only xyz are space axes, the additional ones have no length unit
    assert_eq!(
        item.axes
            .iter()
            .filter(|a| a.kind == "space")
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>(),
        ["x", "y", "z"]
    );
    assert!(item.axes[1..3].iter().all(|a| a.unit.is_none()));
    // Byte-identical to Scala `NgffAxis(name, "custom")`
    assert_eq!(
        serde_json::to_string(&item.axes[1]).unwrap(),
        r#"{"name":"angle","type":"custom"}"#
    );
}

#[test]
fn ngff_keeps_four_axes_without_additional_axes() {
    let metadata = NgffMetadata::from_name_voxel_size_and_mags(
        "layer",
        &ngff_voxel_size(),
        &ngff_mags(),
        None,
    );
    let item = &metadata.multiscales[0];
    assert_eq!(
        item.axes
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>(),
        ["c", "x", "y", "z"]
    );
    assert_eq!(
        item.datasets[0].coordinate_transformations[0].scale,
        Some(vec![1.0, 11.0, 11.0, 24.0])
    );
}

#[test]
fn chunk_keys_of_singleton_axis_array_are_accepted() {
    let header = ZarrHeader::for_array(
        ElementClass::Uint32,
        &additional_axes_bbox(),
        &singleton_t_axis(),
        ones(),
    );
    let chunk_key = format!("{}.33.27.4", vec!["0"; header.shape.len() - 3].join("."));
    let result =
        parse_dot_coordinates(&chunk_key, &reorder_additional_axes(&singleton_t_axis())).unwrap();
    assert_eq!(
        result,
        (
            33,
            27,
            4,
            Some(vec![RequestedAdditionalCoordinate {
                name: "t".into(),
                value: 0,
                length: None
            }])
        )
    );
}

#[test]
fn chunk_keys_map_additional_coordinates_in_index_order() {
    let result =
        parse_dot_coordinates("0.2.4.1.1.1", &reorder_additional_axes(&unordered_axes())).unwrap();
    let coordinate = |name: &str, value| RequestedAdditionalCoordinate {
        name: name.into(),
        value,
        length: None,
    };
    assert_eq!(
        result,
        (
            1,
            1,
            1,
            Some(vec![coordinate("angle", 2), coordinate("t", 4)])
        )
    );
}

#[test]
fn chunk_keys_without_additional_axes_are_rejected() {
    assert!(
        parse_dot_coordinates("0.33.27.4", &reorder_additional_axes(&singleton_t_axis())).is_err()
    );
}
