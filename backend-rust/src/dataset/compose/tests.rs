use super::*;
use crate::dataset::source::{Category, Mag};

fn layer(name: &str, mags: &[[i32; 3]]) -> Layer {
    Layer {
        name: name.into(),
        category: Category::Color,
        data_format: "zarr3".into(),
        bounding_box: [1, 2, 3, 10, 20, 30],
        element_class: "uint8".into(),
        mags: mags
            .iter()
            .map(|m| Mag {
                mag: *m,
                path: None,
                axis_order: None,
                channel_index: None,
                credential_id: None,
            })
            .collect(),
        default_view_configuration: None,
        admin_view_configuration: None,
        coordinate_transformations: None,
        additional_axes: None,
        attachments: None,
        largest_segment_id: None,
        mappings: None,
    }
}

#[test]
fn voxel_sizes_are_rescaled_to_the_finest_common_one() {
    let nm = |f: [f64; 3]| VoxelSize {
        factor: f,
        unit: "nanometer".into(),
    };
    let (layers, size) = adapt_layers_and_voxel_size(vec![
        (layer("a", &[[1, 1, 1], [2, 2, 2]]), nm([4.0, 4.0, 4.0])),
        (layer("a", &[[1, 1, 1]]), nm([8.0, 8.0, 8.0])),
    ])
    .unwrap();
    assert_eq!(size, nm([4.0, 4.0, 4.0]));
    assert_eq!(layers[1].name, "a_2");
    assert_eq!(layers[1].mags[0].mag, [2, 2, 2]);
    assert_eq!(layers[1].bounding_box, [2, 4, 6, 20, 40, 60]);
    let micrometer = VoxelSize {
        factor: [0.008, 0.008, 0.008],
        unit: "micrometer".into(),
    };
    let (_, size) = adapt_layers_and_voxel_size(vec![
        (layer("a", &[[1, 1, 1]]), nm([4.0, 4.0, 4.0])),
        (layer("b", &[[2, 2, 2]]), micrometer),
    ])
    .unwrap();
    assert_eq!(size.factor, [4.0, 4.0, 4.0]);
    assert!(
        adapt_layers_and_voxel_size(vec![
            (layer("a", &[[1, 1, 1]]), nm([4.0, 4.0, 4.0])),
            (layer("b", &[[1, 1, 1]]), nm([12.0, 12.0, 12.0])),
        ])
        .is_err()
    );
}
