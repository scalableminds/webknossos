//! Scala `DatasetUploadMetadataStoreTestSuite`: the upload id stored per data source id is a plain
//! string (not JSON-encoded), so the unfinished-upload lookup reads back the identical id.

use crate::fake_redis;

use fake_redis::FakeRedis;
use webknossos_common::datasource::DataSourceId;
use webknossos_datastore::{
    config::RedisConfig,
    redis::store::RedisStore,
    services::upload::{UploadDomain, UploadMetadataStore},
};

#[tokio::test]
async fn returns_the_identical_upload_id_stored_for_a_data_source_id() {
    let redis = FakeRedis::start().await;
    let store = UploadMetadataStore::new(
        UploadDomain::Dataset,
        RedisStore::new(&RedisConfig {
            address: "127.0.0.1".into(),
            port: redis.port,
        }),
    );
    let id = DataSourceId {
        directory_name: "l4_sample".into(),
        organization_id: "sample_organization".into(),
    };
    let upload_id = "2026-10-15_13-33__l4_sample__55d3cfab0f03";
    store
        .insert_upload_id_by_data_source_id(&id, upload_id)
        .await
        .unwrap();
    assert_eq!(
        store.find_upload_id_by_data_source_id(&id).await.unwrap(),
        Some(upload_id.to_owned())
    );
    // Stored raw, byte-compatible with Scala's plain `insert`, with the idle expiry.
    let key =
        r#"upload___dataset______{"name":"l4_sample","team":"sample_organization"}___datasourceId"#;
    assert_eq!(redis.text(key).as_deref(), Some(upload_id));
    assert_eq!(redis.data.lock().unwrap().ttls[key], 14 * 24 * 3600);
    // An unknown data source id has no upload id.
    let other = DataSourceId {
        directory_name: "other".into(),
        organization_id: "sample_organization".into(),
    };
    assert_eq!(
        store
            .find_upload_id_by_data_source_id(&other)
            .await
            .unwrap(),
        None
    );
}
