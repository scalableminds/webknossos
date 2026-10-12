//! Scala NgffZarr3GroupHeader: OME 0.5 metadata lives at attributes.ome.
use crate::{
    datareaders::zarr::ngff::NgffMetadataV0_5,
    error::{DsError, DsResult},
};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(from = "GroupWire", into = "GroupWire")]
pub struct NgffZarr3GroupHeader {
    pub zarr_format: i32,
    pub node_type: String,
    pub ngff_metadata: NgffMetadataV0_5,
}
#[derive(Serialize, Deserialize)]
struct GroupWire {
    zarr_format: i32,
    node_type: String,
    attributes: Attributes,
}
#[derive(Serialize, Deserialize)]
struct Attributes {
    ome: NgffMetadataV0_5,
}
impl From<GroupWire> for NgffZarr3GroupHeader {
    fn from(w: GroupWire) -> Self {
        Self {
            zarr_format: w.zarr_format,
            node_type: w.node_type,
            ngff_metadata: w.attributes.ome,
        }
    }
}
impl From<NgffZarr3GroupHeader> for GroupWire {
    fn from(h: NgffZarr3GroupHeader) -> Self {
        Self {
            zarr_format: h.zarr_format,
            node_type: h.node_type,
            attributes: Attributes {
                ome: h.ngff_metadata,
            },
        }
    }
}
impl NgffZarr3GroupHeader {
    pub fn parse(bytes: &[u8]) -> DsResult<Self> {
        serde_json::from_slice(bytes).map_err(|e| DsError::failure(e.to_string()))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ome05_group_wrapper_round_trip() {
        let value = serde_json::json!({"zarr_format":3,"node_type":"group","attributes":{"ome":{"version":"0.5","multiscales":[{"axes":[{"name":"x","type":"space","unit":"nanometer"}],"datasets":[{"path":"0","coordinateTransformations":[{"type":"scale","scale":[10.]}]}]}]}}});
        let h = NgffZarr3GroupHeader::parse(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(h.ngff_metadata.version, "0.5");
        assert_eq!(h.ngff_metadata.multiscales[0].as_v0_4().version, "0.5");
        assert_eq!(serde_json::to_value(&h).unwrap(), value);
        assert!(
            NgffZarr3GroupHeader::parse(
                br#"{"zarr_format":3,"node_type":"group","attributes":{}}"#
            )
            .is_err()
        );
    }
}
