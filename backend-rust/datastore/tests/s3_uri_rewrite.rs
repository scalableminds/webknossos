mod common;
mod mock_s3;
mod mock_wk;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use mock_s3::{MockS3, Reply};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
use webknossos_datastore::{
    AppState,
    datavault::{
        BoxFuture, CredentialLookup, DataVaultCredential, DataVaultService,
        DataVaultServiceOptions, GcsOptions, S3Options, UPath,
    },
    error::{DsError, DsResult},
    router,
};

struct NoLookup;
impl CredentialLookup for NoLookup {
    fn find_credential<'a>(&'a self, _: &'a str) -> BoxFuture<'a, DsResult<DataVaultCredential>> {
        Box::pin(async { Err(DsError::failure("No fixture credential")) })
    }
}
fn credential(id: &str) -> DataVaultCredential {
    DataVaultCredential::S3AccessKey {
        name: "s3://bucket".into(),
        access_key_id: id.into(),
        secret_access_key: "example-secret".into(),
        user: None,
        organization: None,
    }
}
fn service(base: &str) -> DataVaultService {
    DataVaultService::new(
        DataVaultServiceOptions {
            datastore_uri: "https://datastore.test".into(),
            local_directory_whitelist: vec![],
            working_dir: PathBuf::from("/tmp"),
            // Region lookup uses the explicitly supplied credential, not managed-upload globals.
            global_credentials: vec![credential("managed-key")],
            s3: S3Options {
                env_credentials: None,
                aws_endpoint_override: Some(base.into()),
            },
            gcs: GcsOptions::from_env(),
        },
        Arc::new(NoLookup),
    )
}
#[tokio::test]
async fn s3_uri_rewrite_matches_actual_scala_helpers_and_uses_explicit_credentials_and_archive_outer_paths()
 {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/managed_s3/scala_uri_rewrite.json")).unwrap();
    for case in cases.as_array().unwrap() {
        for authenticated in [false, true] {
            let region = case["region"].as_str().map(str::to_owned);
            let mock = MockS3::start(move |call| {
                assert_eq!(call.method, "HEAD");
                assert_eq!(call.path, "/bucket");
                if authenticated {
                    assert!(
                        call.headers["authorization"]
                            .to_str()
                            .unwrap()
                            .contains("Credential=example-key/")
                    );
                } else {
                    assert!(!call.headers.contains_key("authorization"));
                }
                let reply = Reply::xml(StatusCode::FORBIDDEN, "");
                match &region {
                    Some(region) => reply.with("x-amz-bucket-region", region),
                    None => reply,
                }
            })
            .await;
            let path = UPath::parse(case["path"].as_str().unwrap()).unwrap();
            let explicit = credential("example-key");
            let result = service(&mock.base())
                .insert_s3_endpoint_if_missing(&path, authenticated.then_some(&explicit))
                .await
                .unwrap();
            assert_eq!(
                result,
                UPath::parse(case["expected"].as_str().unwrap()).unwrap()
            );
            let short =
                webknossos_datastore::datavault::s3::is_short_style(&path.to_remote_uri().unwrap());
            assert_eq!(mock.calls().len(), usize::from(short));
        }
    }
    let mock = MockS3::start(|_| {
        Reply::xml(StatusCode::FORBIDDEN, "").with("x-amz-bucket-region", "eu-west-1")
    })
    .await;
    let zip = UPath::parse("s3://bucket/archive.ozx|zip:group/array").unwrap();
    let result = service(&mock.base())
        .insert_s3_endpoint_if_missing(&zip, None)
        .await
        .unwrap();
    assert_eq!(
        result,
        UPath::parse("s3://s3.eu-west-1.amazonaws.com/bucket/archive.ozx|zip:group/array").unwrap()
    );
    let port = common::closed_port().await;
    let result = service(&format!("http://127.0.0.1:{port}"))
        .insert_s3_endpoint_if_missing(&UPath::parse("s3://bucket/key").unwrap(), None)
        .await
        .unwrap();
    assert_eq!(result.to_string(), "s3://s3.amazonaws.com/bucket/key");
}

#[tokio::test]
async fn explore_remote_returns_regional_or_global_paths_and_denial_has_no_region_or_storage_effects()
 {
    for regional in [false, true] {
        let s3 = MockS3::start(move |call| {
            if call.method == "HEAD" {
                let reply = Reply::xml(StatusCode::FORBIDDEN,"");
                return if regional { reply.with("x-amz-bucket-region","eu-central-1") } else { reply };
            }
            assert_eq!(call.method,"GET");
            if call.path.ends_with("/.zarray") { Reply::xml(StatusCode::OK,&json!({"zarr_format":2,"shape":[4,5,6],"chunks":[4,5,6],"dtype":"|u1","order":"C","compressor":null,"fill_value":0}).to_string()) }
            else { Reply::xml(StatusCode::NOT_FOUND,"<Error><Code>NoSuchKey</Code></Error>") }
        }).await;
        let wk = mock_wk::MockWk::start(|call| {
            assert!(call.path.ends_with("/validateUserAccess"));
            mock_wk::Reply::json(
                StatusCode::OK,
                json!({"granted":call.query_value("token").as_deref()!=Some("denied")}),
            )
        })
        .await;
        let mut state = AppState::new(wk.config());
        state.data_vaults = service(&s3.base());
        let app = router(state);
        let request =
            json!({"organizationId":"org","layerParameters":[{"remoteUri":"s3://bucket/array"}]});
        let (status, _, bytes) = common::send(
            app.clone(),
            Request::post("/data/datasets/exploreRemote")
                .header("x-auth-token", "user")
                .header("content-type", "application/json")
                .body(Body::from(request.to_string()))
                .unwrap(),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body["dataSource"]["dataLayers"][0]["mags"][0]["path"],
            if regional {
                "s3://s3.eu-central-1.amazonaws.com/bucket/array"
            } else {
                "s3://s3.amazonaws.com/bucket/array"
            }
        );
        assert_eq!(s3.calls().iter().filter(|c| c.method == "HEAD").count(), 1);
        let before = s3.calls().len();
        let (status, _, _) = common::send(
            app.clone(),
            Request::post("/data/datasets/exploreRemote")
                .header("x-auth-token", "denied")
                .header("content-type", "application/json")
                .body(Body::from(request.to_string()))
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(s3.calls().len(), before);
    }
}
