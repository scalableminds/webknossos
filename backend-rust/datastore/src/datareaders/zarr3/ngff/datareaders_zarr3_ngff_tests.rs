use super::*;
#[test]
fn ome05_group_wrapper_round_trip() {
    let value = serde_json::json!({"zarr_format":3,"node_type":"group","attributes":{"ome":{"version":"0.5","multiscales":[{"axes":[{"name":"x","type":"space","unit":"nanometer"}],"datasets":[{"path":"0","coordinateTransformations":[{"type":"scale","scale":[10.]}]}]}]}}});
    let h = NgffZarr3GroupHeader::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(h.ngff_metadata.version, "0.5");
    assert_eq!(h.ngff_metadata.multiscales[0].as_v0_4().version, "0.5");
    assert_eq!(serde_json::to_value(&h).unwrap(), value);
    assert!(
        NgffZarr3GroupHeader::parse(br#"{"zarr_format":3,"node_type":"group","attributes":{}}"#)
            .is_err()
    );
}
