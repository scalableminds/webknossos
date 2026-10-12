//! Scala `DSRemoteTracingstoreClient`: volume-annotation Zarr metadata and chunks served by the
//! tracingstore, requested with the caller's token context.
use serde_json::Value;

use crate::{
    access::TokenContext,
    error::{DsError, DsResult},
    wk_client::Rpc,
};

/// Scala `EditableMappingSegmentListResult`.
#[derive(Debug, Clone, PartialEq)]
pub struct EditableMappingSegmentList {
    pub segment_ids: Vec<i64>,
    pub agglomerate_id_is_present: bool,
}

#[derive(Clone)]
pub struct TracingstoreClient {
    rpc: Rpc,
}

fn zarr_sub_path(zarr_version: u8) -> &'static str {
    if zarr_version == 2 { "zarr" } else { "zarr3" }
}

impl TracingstoreClient {
    pub fn new(rpc: Rpc) -> Self {
        Self { rpc }
    }

    async fn get_json(&self, url: String, tc: &TokenContext) -> DsResult<Value> {
        self.rpc.request(url).with_token(tc).get_json().await
    }

    /// Scala `getZArray`.
    pub async fn z_array(
        &self,
        uri: &str,
        tracing_id: &str,
        mag: &str,
        tc: &TokenContext,
    ) -> DsResult<Value> {
        self.get_json(
            format!("{uri}/tracings/volume/zarr/{tracing_id}/{mag}/.zarray"),
            tc,
        )
        .await
    }

    /// Scala `getZarrJson`.
    pub async fn zarr_json(
        &self,
        uri: &str,
        tracing_id: &str,
        mag: &str,
        tc: &TokenContext,
    ) -> DsResult<Value> {
        self.get_json(
            format!("{uri}/tracings/volume/zarr3/{tracing_id}/{mag}/zarr.json"),
            tc,
        )
        .await
    }

    /// Scala `getVolumeLayerAsZarrLayer`.
    pub async fn volume_layer_as_zarr_layer(
        &self,
        uri: &str,
        tracing_id: &str,
        tracing_name: Option<&str>,
        zarr_version: u8,
        tc: &TokenContext,
    ) -> DsResult<Value> {
        self.rpc
            .request(format!(
                "{uri}/tracings/volume/{}/{tracing_id}/zarrSource",
                zarr_sub_path(zarr_version)
            ))
            .with_token(tc)
            .query_opt("tracingName", tracing_name)
            .get_json()
            .await
    }

    /// Scala `getOmeNgffHeader`.
    pub async fn ome_ngff_header(
        &self,
        uri: &str,
        tracing_id: &str,
        tc: &TokenContext,
    ) -> DsResult<Value> {
        self.get_json(
            format!("{uri}/tracings/volume/zarr/{tracing_id}/.zattrs"),
            tc,
        )
        .await
    }

    /// Scala `getZarrJsonGroupHeaderWithNgff`.
    pub async fn zarr_json_group_header(
        &self,
        uri: &str,
        tracing_id: &str,
        tc: &TokenContext,
    ) -> DsResult<Value> {
        self.get_json(
            format!("{uri}/tracings/volume/zarr3/{tracing_id}/zarr.json"),
            tc,
        )
        .await
    }

    /// Scala `getRawZarrCube` (silent even on failure).
    pub async fn raw_zarr_cube(
        &self,
        uri: &str,
        tracing_id: &str,
        mag: &str,
        cxyz: &str,
        tc: &TokenContext,
    ) -> DsResult<Vec<u8>> {
        self.rpc
            .request(format!(
                "{uri}/tracings/volume/zarr/{tracing_id}/{mag}/{cxyz}"
            ))
            .silent_even_on_failure()
            .with_token(tc)
            .get()
            .await
    }

    /// Scala `getDataLayerMagDirectoryContents`.
    pub async fn mag_directory_contents(
        &self,
        uri: &str,
        tracing_id: &str,
        mag: &str,
        zarr_version: u8,
        tc: &TokenContext,
    ) -> DsResult<Vec<String>> {
        self.rpc
            .request(format!(
                "{uri}/tracings/volume/{}/json/{tracing_id}/{mag}",
                zarr_sub_path(zarr_version)
            ))
            .with_token(tc)
            .get_json()
            .await
    }

    /// Scala `getDataLayerDirectoryContents`.
    pub async fn layer_directory_contents(
        &self,
        uri: &str,
        tracing_id: &str,
        zarr_version: u8,
        tc: &TokenContext,
    ) -> DsResult<Vec<String>> {
        self.rpc
            .request(format!(
                "{uri}/tracings/volume/{}/json/{tracing_id}",
                zarr_sub_path(zarr_version)
            ))
            .with_token(tc)
            .get_json()
            .await
    }

    /// Scala `getZGroup`.
    pub async fn z_group(&self, uri: &str, tracing_id: &str, tc: &TokenContext) -> DsResult<Value> {
        self.get_json(
            format!("{uri}/tracings/volume/zarr/{tracing_id}/.zgroup"),
            tc,
        )
        .await
    }

    /// Scala `getEditableMappingSegmentIdsForAgglomerate` (silent).
    pub async fn editable_mapping_segment_ids(
        &self,
        uri: &str,
        tracing_id: &str,
        version: Option<i64>,
        agglomerate_id: i64,
        tc: &TokenContext,
    ) -> DsResult<EditableMappingSegmentList> {
        let value: Value = self
            .rpc
            .request(format!(
                "{uri}/tracings/mapping/{tracing_id}/segmentsForAgglomerate"
            ))
            .query("agglomerateId", agglomerate_id)
            .query_opt("version", version)
            .with_token(tc)
            .silent()
            .get_json()
            .await?;
        let invalid =
            || DsError::failure("JSON validation failed: invalid EditableMappingSegmentListResult");
        let segment_ids = value["segmentIds"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .map(|v| {
                crate::models::datasource::read_unsigned_long(v)
                    .map(|u| u as i64)
                    .map_err(|_| invalid())
            })
            .collect::<DsResult<Vec<_>>>()?;
        Ok(EditableMappingSegmentList {
            segment_ids,
            agglomerate_id_is_present: value["agglomerateIdIsPresent"]
                .as_bool()
                .ok_or_else(invalid)?,
        })
    }
}
