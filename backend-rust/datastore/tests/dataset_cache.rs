mod mock_wk;
use axum::http::StatusCode;
use mock_wk::{KEY, MockWk, Reply};
use serde_json::json;
use std::sync::{Arc, Mutex};
use webknossos_datastore::{services::DatasetCache, wk_client::WkClient};

fn source() -> serde_json::Value {
    json!({"id":{"name":"ds","team":"org"},"scale":[1,1,1],"dataLayers":[
        {"name":"color","category":"color","elementClass":"uint8","dataFormat":"zarr",
         "boundingBox":{"topLeft":[0,0,0],"width":32,"height":32,"depth":32},
         "mags":[{"mag":[1,1,1],"path":"https://data.example/array","credentialId":"credential"}]}]})
}

#[tokio::test]
async fn concurrent_cache_loads_layer_lookup_and_manual_invalidation() {
    let data = Arc::new(Mutex::new(source()));
    let returned = Arc::clone(&data);
    let wk = MockWk::start(move |call| {
        assert_eq!(call.query_value("key").as_deref(), Some(KEY));
        assert_eq!(call.path, "/api/datastores/test-ds/datasources/id");
        Reply::json(StatusCode::OK, returned.lock().unwrap().clone())
    })
    .await;
    let cache = DatasetCache::new(WkClient::new(&wk.config()).unwrap());
    let (a, b, c) = tokio::join!(
        cache.get_by_id("id"),
        cache.get_by_id("id"),
        cache.get_by_id("id")
    );
    let a = a.unwrap();
    assert!(Arc::ptr_eq(&a, &b.unwrap()));
    assert!(Arc::ptr_eq(&a, &c.unwrap()));
    assert_eq!(wk.calls().len(), 1);
    let (_, layer) = cache.get_with_layer("id", "color").await.unwrap();
    assert_eq!(
        layer.mags[0].path.as_ref().unwrap().to_string(),
        "https://data.example/array"
    );
    assert_eq!(layer.mags[0].credential_id.as_deref(), Some("credential"));
    assert_eq!(
        cache
            .get_with_layer("id", "absent")
            .await
            .unwrap_err()
            .message,
        "Could not find layer “absent” in dataset."
    );
    data.lock().unwrap()["dataLayers"][0]["name"] = json!("updated");
    assert!(cache.get_with_layer("id", "color").await.is_ok());
    cache.invalidate("id");
    assert!(cache.is_empty());
    assert!(cache.get_with_layer("id", "updated").await.is_ok());
    assert_eq!(wk.calls().len(), 2);
    assert_eq!(cache.len(), 1);
}

#[tokio::test]
async fn unusable_and_rpc_failures_retry_without_caching() {
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = Arc::clone(&count);
    let wk =
        MockWk::start(
            move |_| match counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) {
                0 => Reply::json(
                    StatusCode::OK,
                    json!({"id":{"name":"ds","team":"org"},"status":"Not imported yet."}),
                ),
                1 => Reply::text(StatusCode::SERVICE_UNAVAILABLE, "temporary"),
                _ => Reply::json(StatusCode::OK, source()),
            },
        )
        .await;
    let cache = DatasetCache::new(WkClient::new(&wk.config()).unwrap());
    assert_eq!(
        cache.get_by_id("id").await.unwrap_err().message,
        "Data source is not usable: Some(Not imported yet.)"
    );
    assert!(cache.is_empty());
    let error = cache.get_by_id("id").await.unwrap_err();
    assert_eq!(error.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        error.message,
        "Failed to get data source from remote webknossos"
    );
    assert!(cache.is_empty());
    cache.get_by_id("id").await.unwrap();
    assert_eq!(wk.calls().len(), 3);
}
