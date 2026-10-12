use std::path::PathBuf;
use webknossos_datastore::services::mesh_geometry::{combine_stl, draco_to_stl, surface_area};
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/draco")
}
#[test]
fn draco_to_stl_matches_actual_jni_for_real_and_synthetic_encodings() {
    for name in [
        "real_30",
        "real_11",
        "real_33",
        "float_sequential",
        "float_edgebreaker",
        "integer_sequential",
        "integer_edgebreaker",
    ] {
        let draco = std::fs::read(root().join(format!("{name}.drc"))).unwrap();
        let expected = std::fs::read(root().join(format!("{name}.stlraw"))).unwrap();
        let actual = draco_to_stl(
            &draco,
            [10.25, -20.5, 0.125],
            [2.5, 0.75, 4.],
            if name.starts_with("integer") { 10 } else { 0 },
        )
        .unwrap();
        assert_eq!(actual, expected, "{name}");
    }
}
#[test]
fn malformed_draco_is_rejected_and_stl_headers_count_actual_faces() {
    let bytes = std::fs::read(root().join("float_sequential.drc")).unwrap();
    for length in 0..bytes.len() {
        assert!(
            draco_to_stl(&bytes[..length], [0.; 3], [1.; 3], 0).is_err(),
            "{length}"
        );
    }
    let chunk = draco_to_stl(&bytes, [0.; 3], [1.; 3], 0).unwrap();
    let combined = combine_stl(&[chunk.clone(), chunk.clone()]).unwrap();
    assert_eq!(&combined[..80], &[0; 80]);
    assert_eq!(
        u32::from_le_bytes(combined[80..84].try_into().unwrap()) as usize,
        2 * chunk.len() / 50
    );
    assert_eq!(&combined[84..84 + chunk.len()], chunk);
    assert_eq!(combine_stl(&[]).unwrap().len(), 84);
    assert!(combine_stl(&[vec![0; 49]]).is_err());
    assert!(surface_area(&[0; 49]).is_err());
}
#[test]
fn stl_normals_and_areas_match_actual_compiled_scala() {
    use webknossos_datastore::services::mesh_geometry::ad_hoc_to_stl;
    let vertices = [
        0., 0., 0., 1., 0., 0., 0., 1., 0., 2., 3., 4., 7., 3., 4., 2., 9., 4.,
    ];
    assert_eq!(
        ad_hoc_to_stl(&vertices).unwrap(),
        std::fs::read(root().join("adhoc.stlraw")).unwrap()
    );
    let areas: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("areas.json")).unwrap()).unwrap();
    for (name, expected) in areas.as_object().unwrap() {
        let raw = std::fs::read(root().join(name)).unwrap();
        assert_eq!(
            surface_area(&raw).unwrap().to_bits(),
            (expected.as_f64().unwrap() as f32).to_bits(),
            "{name}"
        );
    }
    assert!(ad_hoc_to_stl(&[0.; 8]).is_err());
    let degenerate = ad_hoc_to_stl(&[0.; 9]).unwrap();
    assert!(f32::from_le_bytes(degenerate[..4].try_into().unwrap()).is_nan());
}
fn vertex_bytes(vertices: &[f32]) -> Vec<u8> {
    vertices.iter().flat_map(|f| f.to_le_bytes()).collect()
}
#[test]
fn every_marching_cube_configuration_and_tile_order_match_actual_scala() {
    use webknossos_datastore::services::marching_cubes::marching_cubes;
    let bytes = std::fs::read(root().join("cubes.bin")).unwrap();
    let mut cursor = 0;
    for cube in 0..256 {
        let corners = [0, 1, 3, 2, 4, 5, 7, 6];
        let mut data = [false; 8];
        for (bit, at) in corners.into_iter().enumerate() {
            data[at] = cube & (1 << bit) != 0;
        }
        let (vertices, _) =
            marching_cubes(&data, [2; 3], [10.25, -20.5, 0.125], [2.5, 0.75, 4.], true).unwrap();
        let count = i32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        assert_eq!(vertices.len(), count, "{cube}");
        assert_eq!(
            vertex_bytes(&vertices),
            bytes[cursor..cursor + count * 4],
            "{cube}"
        );
        cursor += count * 4;
    }
    assert_eq!(cursor, bytes.len());
    let n = 35;
    let mut data = vec![false; n * n * n];
    for z in 30..34 {
        for y in 31..34 {
            for x in 30..34 {
                data[x + n * (y + n * z)] = true;
            }
        }
    }
    let (vertices, neighbors) =
        marching_cubes(&data, [n; 3], [10.25, -20.5, 0.125], [2.5, 0.75, 4.], true).unwrap();
    assert!(neighbors.is_empty());
    assert_eq!(
        vertex_bytes(&vertices),
        std::fs::read(root().join("tiled.bin")).unwrap()
    );
}
#[test]
fn marching_cube_neighbors_preserve_excluded_edges_and_degenerate_dimensions() {
    use webknossos_datastore::services::marching_cubes::marching_cubes;
    let generate = |data: &[bool], dims, neighbors| {
        marching_cubes(data, dims, [0.; 3], [1.; 3], neighbors).unwrap()
    };
    let mut data = [false; 27];
    data[0] = true;
    assert_eq!(generate(&data, [3; 3], true).1, [0, 1, 2]);
    data[26] = true;
    assert_eq!(generate(&data, [3; 3], true).1, [0, 1, 2]);
    data[18] = true;
    data[6] = true;
    data[2] = true;
    assert_eq!(generate(&data, [3; 3], true).1, [0, 1, 2, 3, 4, 5]);
    assert!(generate(&data, [3; 3], false).1.is_empty());
    let (vertices, neighbors) = generate(&[true], [1; 3], true);
    assert!(vertices.is_empty() && neighbors.is_empty());
    assert!(marching_cubes(&[true], [usize::MAX, 2, 2], [0.; 3], [1.; 3], true).is_err());
    assert!(marching_cubes(&[true], [0, 1, 1], [0.; 3], [1.; 3], true).is_err());
}
#[test]
fn typed_json_mapping_matches_actual_scala_parser_including_narrowed_duplicates() {
    use webknossos_datastore::services::mapping::parse_mapping;
    let input = std::fs::read(root().join("mapping.json")).unwrap();
    let oracle: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("mapping_oracle.json")).unwrap())
            .unwrap();
    for width in [1, 2, 4, 8] {
        let actual = parse_mapping(&input, width).unwrap();
        let expected = oracle[width.to_string()]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| {
                (
                    k.parse::<u64>().unwrap(),
                    v.as_str().unwrap().parse::<u64>().unwrap(),
                )
            })
            .collect();
        assert_eq!(actual, expected, "{width}");
    }
    for bad in [
        br#"{"classes":[]}"#.as_slice(),
        br#"{"name":"x","classes":[[1,null]]}"#,
        br#"{"name":"x","classes":[[1,2.5]]}"#,
        br#"{"name":"x","classes":false}"#,
    ] {
        assert!(parse_mapping(bad, 1).is_err());
    }
    assert!(parse_mapping(&input, 3).is_err());
}
