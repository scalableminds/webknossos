mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::StatusCode,
};
use common::{TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, remote_datastore_dataset_upload};

const NOT_YET_UPLOADED: &str = "Not yet fully uploaded.";
const TOKEN_INVALID: &str = "The supplied token is invalid or expired.";
const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
const STORAGE_EXCEEDED: &str =
    "Cannot upload dataset because the storage quota of the organization is exceeded.";
const DATASTORE_RESTRICTED: &str = "Your organization does not have permission to upload datasets to this data store. Please choose another data store.";
const INVALID_LINKED_LAYERS: &str = "Could not link all requested layers.";
const CREATE_FAILED: &str = "Could not create dataset.";

async fn setup() -> (TestDb, Router) {
    let db = TestDb::new().await;
    let app = remote_datastore_dataset_upload::router().with_state(AppState {
        pool: db.pool.clone(),
    });
    (db, app)
}

async fn seed_store(db: &TestDb, name: &str, key: &str, only_allowed: Option<&str>) {
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key,onlyAllowedOrganization) VALUES ($1,$2,$3,$4,$5)")
        .bind(name)
        .bind(format!("http://{name}.invalid"))
        .bind(format!("http://public-{name}.invalid"))
        .bind(key)
        .bind(only_allowed)
        .execute(&db.pool)
        .await
        .unwrap();
}

async fn call(app: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut request = axum::http::Request::builder().method(method).uri(uri);
    let body = match body {
        Some(body) => {
            request = request.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(request.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

fn error(message: &str) -> Value {
    json!({"messages": [{"error": message}]})
}

fn forbidden() -> Value {
    json!({"granted": false, "msg": "Data store could not be found or accessed."})
}

fn reserve_uri(store: &str, key: &str, token: &str) -> String {
    format!("/datastores/{store}/reserveDatasetUpload?key={key}&token={token}")
}

fn upload_info(organization: &str, name: &str, size: Option<i64>, extra: Value) -> Value {
    let mut body = json!({
        "resumableUploadInfo": {"uploadId": "upload-1", "totalFileCount": 2, "filePaths": ["a", "b"], "totalFileSizeInBytes": size},
        "datasetName": name,
        "organizationId": organization,
        "initialTeamIds": [],
    });
    for (key, value) in extra.as_object().unwrap() {
        body[key] = value.clone();
    }
    body
}

/// A usable dataset in `organization`'s root folder.
async fn seed_dataset(db: &TestDb, organization: &str, name: &str, is_public: bool) -> String {
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_organization,_dataStore,_folder,name,directoryName,isUsable,isPublic,voxelSizeFactor,sortingKey) SELECT $1,_id,'store',_rootFolder,$2,$1,TRUE,$3,ROW(1,1,1)::webknossos.VECTOR3,NOW() FROM webknossos.organizations WHERE _id=$4")
        .bind(&id).bind(name).bind(is_public).bind(organization)
        .execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'color','color','uint8',ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path) VALUES ($1,'color',ROW(1,1,1)::webknossos.VECTOR3,'s3://bucket/color/1')")
        .bind(&id).execute(&db.pool).await.unwrap();
    id
}

async fn dataset_count(db: &TestDb, organization: &str) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM webknossos.datasets WHERE _organization = $1")
        .bind(organization)
        .fetch_one(&db.pool)
        .await
        .unwrap()
}

async fn add_role(db: &TestDb, user: &str, team: &str, manager: bool) {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user,_team,isTeamManager) VALUES ($1,$2,$3)",
    )
    .bind(user)
    .bind(team)
    .bind(manager)
    .execute(&db.pool)
    .await
    .unwrap();
}

type DatasetRow = (
    String,
    String,
    String,
    bool,
    bool,
    Option<String>,
    String,
    Option<String>,
    String,
    bool,
);

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn reserve_dataset_upload_contracts() {
    let (db, app) = setup().await;
    let owner = db.fixture().await;
    let stranger = db.fixture().await;
    seed_store(&db, "store", "service-key", None).await;
    seed_store(
        &db,
        "restricted",
        "restricted-key",
        Some(&stranger.organization_id),
    )
    .await;
    let org = owner.organization_id.as_str();
    let uri = reserve_uri("store", "service-key", &owner.token);
    let valid = upload_info(org, "new_dataset", Some(10), json!({}));

    // Datastore key, query binding, token (403 here).
    let (status, body) = call(
        &app,
        "POST",
        &reserve_uri("store", "wrong", &owner.token),
        Some(valid.clone()),
    )
    .await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, forbidden()));
    let (status, body) = call(
        &app,
        "POST",
        &reserve_uri("missing", "service-key", &owner.token),
        Some(valid.clone()),
    )
    .await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, forbidden()));
    let (status, body) = call(
        &app,
        "POST",
        "/datastores/store/reserveDatasetUpload?key=service-key",
        Some(valid.clone()),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error("Invalid query parameters."))
    );
    let (status, body) = call(
        &app,
        "POST",
        &reserve_uri("store", "service-key", "bogus"),
        Some(valid.clone()),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::FORBIDDEN, error(TOKEN_INVALID))
    );
    // Body validation: initialTeamIds is required, ids must be ObjectIds.
    let mut missing_teams = valid.clone();
    missing_teams
        .as_object_mut()
        .unwrap()
        .remove("initialTeamIds");
    assert_eq!(
        call(&app, "POST", &uri, Some(missing_teams)).await.0,
        StatusCode::BAD_REQUEST
    );
    let bad_folder = upload_info(org, "new_dataset", None, json!({"folderId": "nope"}));
    assert_eq!(
        call(&app, "POST", &uri, Some(bad_folder)).await.0,
        StatusCode::BAD_REQUEST
    );

    // Organization lookup precedes storage and ownership checks.
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info("missing-org", "new_dataset", None, json!({}))),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::NOT_FOUND,
            error("Organization “missing-org” could not be found or accessed.")
        )
    );
    // Storage quota of the *requested* organization is checked before ownership.
    let stranger_dataset = seed_dataset(&db, &stranger.organization_id, "stranger_ds", false).await;
    sqlx::query("UPDATE webknossos.organizations SET includedStorage = 100 WHERE _id = $1")
        .bind(&stranger.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_mags (_dataset,layerName,mag,path,_organization,usedStorageBytes) VALUES ($1,'color',ROW(1,1,1)::webknossos.VECTOR3,'p',$2,60)")
        .bind(&stranger_dataset).bind(&stranger.organization_id).execute(&db.pool).await.unwrap();
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(
            &stranger.organization_id,
            "new_dataset",
            Some(41),
            json!({}),
        )),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::FORBIDDEN, error(STORAGE_EXCEEDED))
    );
    // Within quota (used + requested == included) → ownership check fails.
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(
            &stranger.organization_id,
            "new_dataset",
            Some(40),
            json!({}),
        )),
    )
    .await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    // Own organization: quota with requested size.
    let owner_dataset = seed_dataset(&db, org, "existing", false).await;
    sqlx::query("UPDATE webknossos.organizations SET includedStorage = 50 WHERE _id = $1")
        .bind(org)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedStorage_mags (_dataset,layerName,mag,path,_organization,usedStorageBytes) VALUES ($1,'color',ROW(1,1,1)::webknossos.VECTOR3,'p',$2,30)")
        .bind(&owner_dataset).bind(org).execute(&db.pool).await.unwrap();
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(org, "new_dataset", Some(21), json!({}))),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::FORBIDDEN, error(STORAGE_EXCEEDED))
    );
    sqlx::query("UPDATE webknossos.organizations SET includedStorage = NULL WHERE _id = $1")
        .bind(org)
        .execute(&db.pool)
        .await
        .unwrap();

    // Dataset name, then datastore restriction.
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(org, "ab", None, json!({}))),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Dataset name is invalid. Please use at least three characters.")
        )
    );
    let (status, body) = call(
        &app,
        "POST",
        &reserve_uri("restricted", "restricted-key", &owner.token),
        Some(upload_info(org, "x y", None, json!({}))),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        error(
            "Dataset name is invalid. Please use only letters, digits, dots, underscores, hyphens."
        )
    );
    let (status, body) = call(
        &app,
        "POST",
        &reserve_uri("restricted", "restricted-key", &owner.token),
        Some(valid.clone()),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(DATASTORE_RESTRICTED))
    );

    // Layers to link: unreadable / missing → 404, readable but not administrable → 400.
    let link =
        |dataset: &str| json!({"layersToLink": [{"datasetId": dataset, "layerName": "color"}]});
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(org, "new_dataset", None, link(&object_id()))),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(INVALID_LINKED_LAYERS))
    );
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(
            org,
            "new_dataset",
            None,
            link(&stranger_dataset),
        )),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::NOT_FOUND, error(INVALID_LINKED_LAYERS))
    );
    let member = db.seed_user(&object_id(), org, false).await;
    add_role(&db, &member.user_id, &owner.team_id, false).await;
    let team_dataset = seed_dataset(&db, org, "team_ds", false).await;
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset,_team) VALUES ($1,$2)")
        .bind(&team_dataset)
        .bind(&owner.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let member_uri = reserve_uri("store", "service-key", &member.token);
    let (status, body) = call(
        &app,
        "POST",
        &member_uri,
        Some(upload_info(org, "new_dataset", None, link(&team_dataset))),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(INVALID_LINKED_LAYERS))
    );
    // A member may link public datasets (also of other organizations); then
    // createAndSetUpDataset fails: no write access to the root folder.
    let public_foreign = seed_dataset(&db, &stranger.organization_id, "public_ds", true).await;
    let (status, body) = call(
        &app,
        "POST",
        &member_uri,
        Some(upload_info(org, "new_dataset", None, link(&public_foreign))),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(CREATE_FAILED))
    );
    // A team manager of the dataset's organization may link it.
    let manager = db.seed_user(&object_id(), org, false).await;
    add_role(&db, &manager.user_id, &owner.team_id, true).await;
    let (status, body) = call(
        &app,
        "POST",
        &reserve_uri("store", "service-key", &manager.token),
        Some(upload_info(org, "new_dataset", None, link(&team_dataset))),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error(CREATE_FAILED))
    );

    // requireUniqueName.
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(
            org,
            "existing",
            None,
            json!({"requireUniqueName": true}),
        )),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Dataset name “existing” is already taken.")
        )
    );

    // Folder of another organization / unknown folder → createFailed.
    let stranger_root: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id = $1")
            .bind(&stranger.organization_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    for folder in [stranger_root, object_id()] {
        let (status, body) = call(
            &app,
            "POST",
            &uri,
            Some(upload_info(
                org,
                "new_dataset",
                None,
                json!({"folderId": folder}),
            )),
        )
        .await;
        assert_eq!(
            (status, body),
            (StatusCode::BAD_REQUEST, error(CREATE_FAILED))
        );
    }
    // Invalid initial team → nothing is created (transactional).
    let before = dataset_count(&db, org).await;
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(
            org,
            "new_dataset",
            None,
            json!({"initialTeamIds": [stranger.team_id]}),
        )),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Can only assign teams the requesting user is in.")
        )
    );
    assert_eq!(dataset_count(&db, org).await, before);

    // Success: duplicate name allowed without requireUniqueName, layers linked
    // (validated only), initial team assigned, defaults applied.
    let subfolder = object_id();
    sqlx::query("INSERT INTO webknossos.folders (_id, name) VALUES ($1, 'Sub')")
        .bind(&subfolder)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.folder_paths (_ancestor,_descendant,depth) SELECT _ancestor,$1,depth+1 FROM webknossos.folder_paths WHERE _descendant = (SELECT _rootFolder FROM webknossos.organizations WHERE _id = $2) UNION ALL SELECT $1,$1,0")
        .bind(&subfolder).bind(org).execute(&db.pool).await.unwrap();
    let mut extra = link(&public_foreign);
    extra["initialTeamIds"] = json!([owner.team_id]);
    extra["folderId"] = json!(subfolder);
    extra["requireUniqueName"] = Value::Null;
    extra["needsConversion"] = json!(false);
    extra["voxelSizeFactor"] = json!([1.0, 2.0, 3.0]);
    extra["voxelSizeUnit"] = json!("nanometer");
    let (status, body) = call(
        &app,
        "POST",
        &uri,
        Some(upload_info(org, "existing", Some(5), extra)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body.as_object().unwrap().len(), 2);
    let id = body["newDatasetId"].as_str().unwrap().to_owned();
    assert_eq!(body["directoryName"], json!(format!("existing-{id}")));
    let row: DatasetRow = sqlx::query_as(
        "SELECT _dataStore, _organization, _folder, isUsable, isVirtual, _uploader, status, creationType::text, directoryName, voxelSizeFactor IS NULL FROM webknossos.datasets WHERE _id = $1",
    )
    .bind(&id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(
        row,
        (
            "store".to_owned(),
            org.to_owned(),
            subfolder.clone(),
            false,
            true,
            Some(owner.user_id.clone()),
            NOT_YET_UPLOADED.to_owned(),
            Some("Upload".to_owned()),
            format!("existing-{id}"),
            true,
        )
    );
    let teams: Vec<String> =
        sqlx::query_scalar("SELECT _team FROM webknossos.dataset_allowedTeams WHERE _dataset = $1")
            .bind(&id)
            .fetch_all(&db.pool)
            .await
            .unwrap();
    assert_eq!(teams, vec![owner.team_id.clone()]);
    let layers: i64 =
        sqlx::query_scalar("SELECT count(*) FROM webknossos.dataset_layers WHERE _dataset = $1")
            .bind(&id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(layers, 0);

    // isVirtual = false (legacy manual uploads) is honoured; the restricted
    // store accepts its own organization.
    let (status, body) = call(
        &app,
        "POST",
        &reserve_uri("restricted", "restricted-key", &stranger.token),
        Some(upload_info(
            &stranger.organization_id,
            "legacy.ds",
            Some(40),
            json!({"isVirtual": false}),
        )),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (store, is_virtual, folder): (String, bool, String) = sqlx::query_as(
        "SELECT _dataStore, isVirtual, _folder FROM webknossos.datasets WHERE _id = $1",
    )
    .bind(body["newDatasetId"].as_str().unwrap())
    .fetch_one(&db.pool)
    .await
    .unwrap();
    let stranger_root: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id = $1")
            .bind(&stranger.organization_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (store.as_str(), is_virtual, folder),
        ("restricted", false, stranger_root)
    );

    db.cleanup().await;
}

async fn expected(db: &TestDb, org: &str, id: &str, name: &str, teams: Value) -> Value {
    let (folder, created): (String, i64) = sqlx::query_as(
        "SELECT _folder, (EXTRACT(EPOCH FROM created) * 1000)::bigint FROM webknossos.datasets WHERE _id = $1",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    json!({
        "uploadId": "<filled-in by datastore>",
        "dataSourceId": {"name": format!("{name}-{id}"), "team": org},
        "datasetName": name,
        "folderId": folder,
        "created": created,
        "allowedTeams": teams,
    })
}

fn unfinished_uri(key: &str, token: &str, organization: &str) -> String {
    format!(
        "/datastores/store/getUnfinishedDatasetUploadsForUser?key={key}&token={token}&organizationId={organization}"
    )
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn unfinished_dataset_uploads_contracts() {
    let (db, app) = setup().await;
    let owner = db.fixture().await;
    let stranger = db.fixture().await;
    seed_store(&db, "store", "service-key", None).await;
    let org = owner.organization_id.as_str();
    let other_user = db.seed_user(&object_id(), org, true).await;

    let (status, body) = call(
        &app,
        "GET",
        &unfinished_uri("wrong", &owner.token, org),
        None,
    )
    .await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, forbidden()));
    let (status, body) = call(
        &app,
        "GET",
        &format!(
            "/datastores/store/getUnfinishedDatasetUploadsForUser?key=service-key&token={}",
            owner.token
        ),
        None,
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error("Invalid query parameters."))
    );
    let (status, body) = call(
        &app,
        "GET",
        &unfinished_uri("service-key", "bogus", org),
        None,
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::FORBIDDEN, error(TOKEN_INVALID))
    );
    let (status, body) = call(
        &app,
        "GET",
        &unfinished_uri("service-key", &owner.token, "missing-org"),
        None,
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::NOT_FOUND,
            error("Organization “missing-org” could not be found or accessed.")
        )
    );
    let (status, body) = call(
        &app,
        "GET",
        &unfinished_uri("service-key", &owner.token, &stranger.organization_id),
        None,
    )
    .await;
    assert_eq!((status, body), (StatusCode::FORBIDDEN, error(NOT_ALLOWED)));
    let (status, body) = call(
        &app,
        "GET",
        &unfinished_uri("service-key", &owner.token, org),
        None,
    )
    .await;
    assert_eq!((status, body), (StatusCode::OK, json!([])));

    // Reserve two uploads through the route, then add rows that must be excluded.
    let reserve = |token: &str, name: &str, teams: Value| {
        let app = app.clone();
        let uri = reserve_uri("store", "service-key", token);
        let body = upload_info(org, name, None, json!({"initialTeamIds": teams}));
        async move {
            let (status, body) = call(&app, "POST", &uri, Some(body)).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            body["newDatasetId"].as_str().unwrap().to_owned()
        }
    };
    let first = reserve(&owner.token, "first", json!([owner.team_id])).await;
    let second = reserve(&owner.token, "second", json!([])).await;
    reserve(&other_user.token, "others", json!([])).await;
    let finished = reserve(&owner.token, "finished", json!([])).await;
    let old = reserve(&owner.token, "old", json!([])).await;
    let other_status = reserve(&owner.token, "status", json!([])).await;
    let deleted = reserve(&owner.token, "deleted", json!([])).await;
    sqlx::query("UPDATE webknossos.datasets SET isUsable = TRUE WHERE _id = $1")
        .bind(&finished)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE webknossos.datasets SET created = NOW() - INTERVAL '15 days' WHERE _id = $1",
    )
    .bind(&old)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE webknossos.datasets SET status = 'Not yet marked as fully uploaded to paths.' WHERE _id = $1")
        .bind(&other_status).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.datasets SET isDeleted = TRUE WHERE _id = $1")
        .bind(&deleted)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.datasets SET created = NOW() - INTERVAL '1 day' WHERE _id = $1")
        .bind(&first)
        .execute(&db.pool)
        .await
        .unwrap();

    let (status, body) = call(
        &app,
        "GET",
        &unfinished_uri("service-key", &owner.token, org),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!([
            expected(&db, org, &first, "first", json!([owner.team_id])).await,
            expected(&db, org, &second, "second", json!([])).await,
        ])
    );
    let (status, body) = call(
        &app,
        "GET",
        &unfinished_uri("service-key", &other_user.token, org),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["datasetName"], json!("others"));

    db.cleanup().await;
}
