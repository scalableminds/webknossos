mod common;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, application_info, auth, dataset_access, datasets};

/// Analytics side effects of the routes stay local (no forwarding URI).
fn offline_misc() -> application_info::MiscState {
    let mut config = application_info::MiscConfig::default();
    config.analytics.uri.clear();
    application_info::MiscState::new(config)
}

fn app(db: &TestDb) -> Router {
    datasets::router()
        .merge(datasets::list_router())
        .merge(datasets::read_router(true))
        .merge(datasets::metadata_router(true))
        .merge(datasets::lookup_router(true))
        .layer(axum::Extension(offline_misc()))
        .with_state(AppState {
            pool: db.pool.clone(),
        })
}

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        builder = builder.header("x-auth-token", token);
    }
    let response = app
        .clone()
        .oneshot(
            builder
                .body(Body::from(body.map(|b| b.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        },
    )
}

async fn seed_dataset(db: &TestDb, fixture: &Fixture, name: &str, public: bool) -> String {
    sqlx::query("INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES ('test-store','http://localhost:9001','http://localhost:9002','secret-key') ON CONFLICT DO NOTHING")
        .execute(&db.pool).await.unwrap();
    let id = object_id();
    sqlx::query("INSERT INTO webknossos.datasets (_id,_dataStore,_organization,_folder,name,directoryName,isPublic,sortingKey,_uploader) SELECT $1,'test-store',$2,_rootFolder,$3,$3,$4,NOW(),$5 FROM webknossos.organizations WHERE _id=$2")
        .bind(&id).bind(&fixture.organization_id).bind(name).bind(public).bind(&fixture.user_id).execute(&db.pool).await.unwrap();
    id
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn dataset_access_covers_public_tokens_inheritance_and_rejects_stale_foreign_grants() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed_dataset(&db, &fixture, "Private_dataset", false).await;
    let member = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let user = auth::authenticate(&db.pool, &member.token).await.unwrap();
    assert!(
        !dataset_access::can_read(&db.pool, Some(&user), &id, None)
            .await
            .unwrap()
    );
    assert!(
        !dataset_access::can_edit(&db.pool, &user, &id)
            .await
            .unwrap()
    );
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user,_team,isTeamManager) VALUES ($1,$2,false)",
    )
    .bind(&member.user_id)
    .bind(&fixture.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO webknossos.folder_allowedTeams (_folder,_team) SELECT _rootFolder,$2 FROM webknossos.organizations WHERE _id=$1")
        .bind(&fixture.organization_id).bind(&fixture.team_id).execute(&db.pool).await.unwrap();
    let child = object_id();
    sqlx::query("INSERT INTO webknossos.folders (_id,name) VALUES ($1,'Child')")
        .bind(&child)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.folder_paths (_ancestor,_descendant,depth) SELECT _rootFolder,$2,1 FROM webknossos.organizations WHERE _id=$1")
        .bind(&fixture.organization_id).bind(&child).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.datasets SET _folder=$2 WHERE _id=$1")
        .bind(&id)
        .bind(&child)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(
        dataset_access::can_read(&db.pool, Some(&user), &id, None)
            .await
            .unwrap()
    );
    assert!(
        !dataset_access::can_edit(&db.pool, &user, &id)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE webknossos.user_team_roles SET isTeamManager=true WHERE _user=$1")
        .bind(&member.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(
        dataset_access::can_edit(&db.pool, &user, &id)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE webknossos.teams SET isDeleted=true WHERE _id=$1")
        .bind(&fixture.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(
        !dataset_access::can_read(&db.pool, Some(&user), &id, None)
            .await
            .unwrap()
    );
    assert!(
        !dataset_access::can_edit(&db.pool, &user, &id)
            .await
            .unwrap()
    );
    let foreign = db.fixture().await;
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset,_team) VALUES ($1,$2)")
        .bind(&id)
        .bind(&foreign.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user,_team,isTeamManager) VALUES ($1,$2,true)",
    )
    .bind(&member.user_id)
    .bind(&foreign.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    assert!(
        !dataset_access::can_read(&db.pool, Some(&user), &id, None)
            .await
            .unwrap()
    );
    assert!(
        !dataset_access::can_edit(&db.pool, &user, &id)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE webknossos.datasets SET sharingToken='shared' WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(
        dataset_access::can_read(&db.pool, None, &id, Some("shared"))
            .await
            .unwrap()
    );
    assert!(
        dataset_access::can_read(&db.pool, Some(&user), &id, Some("shared"))
            .await
            .unwrap()
    );
    assert!(
        !dataset_access::can_read(&db.pool, None, &id, Some("invalid"))
            .await
            .unwrap()
    );
    let annotation = object_id();
    sqlx::query("INSERT INTO webknossos.annotations (_id,_dataset,_user,typ) VALUES ($1,$2,$3,'Explorational')").bind(&annotation).bind(&id).bind(&member.user_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.annotation_privateLinks (_id,_annotation,accessToken,expirationDateTime) VALUES ($1,$2,'private-link',NOW()-INTERVAL '1 day')").bind(object_id()).bind(&annotation).execute(&db.pool).await.unwrap();
    // DatasetDAO intentionally treats a private-link token as a dataset grant
    // without expiration filtering; annotation-link routes own that check.
    assert!(
        dataset_access::can_read(&db.pool, None, &id, Some("private-link"))
            .await
            .unwrap()
    );
    sqlx::query("UPDATE webknossos.annotations SET isDeleted=true WHERE _id=$1")
        .bind(&annotation)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(
        !dataset_access::can_read(&db.pool, None, &id, Some("private-link"))
            .await
            .unwrap()
    );
    sqlx::query("UPDATE webknossos.datasets SET isPublic=true WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(
        dataset_access::can_read(&db.pool, None, &id, None)
            .await
            .unwrap()
    );
    sqlx::query("UPDATE webknossos.datasets SET isDeleted=true WHERE _id=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(
        !dataset_access::can_read(&db.pool, None, &id, Some("shared"))
            .await
            .unwrap()
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn compact_and_full_dataset_responses_preserve_composites_paths_unsigned_ids_and_redaction() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed_dataset(&db, &fixture, "Public_sample", true).await;
    let private = seed_dataset(&db, &fixture, "Other_private", false).await;
    sqlx::query("UPDATE webknossos.datasets SET isUsable=true,voxelSizeFactor=ROW(4,5,6)::webknossos.VECTOR3,voxelSizeUnit='micrometer',tags=ARRAY['z','a'] WHERE _id=$1").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat,largestSegmentId,defaultViewConfiguration) VALUES ($1,'seg','segmentation','uint64',ROW(1,2,3,20,30,40)::webknossos.BOUNDING_BOX,'zarr3',-1,'{\"nested\":{\"credentialId\":\"secret\",\"credentials\":{\"password\":\"secret\"},\"visible\":null}}')").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,path,realPath,axisOrder,channelIndex) VALUES ($1,'seg',ROW(2,2,1)::webknossos.VECTOR3,'relative','/absolute/real','{\"x\":0,\"y\":1,\"z\":2}',4),($1,'seg',ROW(1,1,1)::webknossos.VECTOR3,'pending',NULL,NULL,NULL)").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.dataset_mags SET uploadIsPending=true WHERE path='pending'")
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_additionalAxes (_dataset,layerName,name,lowerBound,upperBound,index) VALUES ($1,'seg','time',0,10,3)").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,realPath,type,dataFormat) VALUES ($1,'seg','mesh-file','relative','/absolute/mesh','mesh','hdf5')").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.workers (_id,_dataStore,key,supportedJobCommands) VALUES ($1,'test-store','worker-key',ARRAY['convert_to_wkw','compute_mesh_file'])").bind(object_id()).execute(&db.pool).await.unwrap();
    let application = app(&db);
    let (status, list) = request(
        &application,
        "GET",
        "/datasets?includeAnnotationCount=true",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], id);
    assert!(list[0].get("annotationCount").is_none());
    assert_eq!(list[0]["segmentationLayerNames"], json!(["seg"]));
    let (status, full) = request(
        &application,
        "GET",
        &format!("/datasets/{id}"),
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{full}");
    assert_eq!(
        full["dataSource"]["id"],
        json!({"name":"Public_sample","team":fixture.organization_id})
    );
    assert_eq!(
        full["dataSource"]["scale"],
        json!({"factor":[4,5,6],"unit":"micrometer"})
    );
    let layer = &full["dataSource"]["dataLayers"][0];
    assert_eq!(
        layer["boundingBox"],
        json!({"topLeft":[1,2,3],"width":20,"height":30,"depth":40})
    );
    assert_eq!(
        layer["largestSegmentId"],
        json!({"customJsonEncoding":"bigint","value":"18446744073709551615"})
    );
    assert_eq!(layer["mags"].as_array().unwrap().len(), 1);
    assert_eq!(layer["mags"][0]["path"], "/absolute/real");
    assert_eq!(layer["attachments"]["meshes"][0]["path"], "/absolute/mesh");
    assert_eq!(
        layer["additionalAxes"],
        json!([{"name":"time","bounds":[0,10],"index":3}])
    );
    assert!(
        layer["defaultViewConfiguration"]["nested"]
            .get("credentialId")
            .is_none()
    );
    assert!(
        layer["defaultViewConfiguration"]["nested"]
            .get("credentials")
            .is_none()
    );
    assert!(
        layer["defaultViewConfiguration"]["nested"]
            .get("visible")
            .unwrap()
            .is_null()
    );
    assert!(full["dataStore"].get("key").is_none());
    assert_eq!(full["dataStore"]["jobsEnabled"], true);
    assert!(full["lastUsedByUser"].as_i64().unwrap() > 0);
    let (_, anonymous) = request(&application, "GET", &format!("/datasets/{id}"), None, None).await;
    assert!(anonymous["uploaderFullName"].is_null());
    assert_eq!(anonymous["allowedTeams"], json!([]));
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("/datasets/{private}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, filtered) = request(
        &application,
        "GET",
        "/datasets?searchQuery=sample%20Public&isActive=true&limit=1",
        None,
        None,
    )
    .await;
    assert_eq!(filtered.as_array().unwrap().len(), 1);
    sqlx::query("UPDATE webknossos.workers SET supportedJobCommands=ARRAY['unknown_command'] WHERE _dataStore='test-store'")
        .execute(&db.pool).await.unwrap();
    let jobs_disabled = datasets::read_router(false)
        .layer(axum::Extension(offline_misc()))
        .with_state(AppState {
            pool: db.pool.clone(),
        });
    assert_eq!(
        request(
            &jobs_disabled,
            "GET",
            &format!("/datasets/{id}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn sharing_tokens_are_atomic_and_team_updates_preserve_unmanageable_grants() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed_dataset(&db, &fixture, "Sharing_dataset", false).await;
    let member = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user,_team,isTeamManager) VALUES ($1,$2,true)",
    )
    .bind(&member.user_id)
    .bind(&fixture.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let protected = object_id();
    sqlx::query("INSERT INTO webknossos.teams (_id,_organization,name) VALUES ($1,$2,'Protected')")
        .bind(&protected)
        .bind(&fixture.organization_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO webknossos.dataset_allowedTeams (_dataset,_team) VALUES ($1,$2),($1,$3)",
    )
    .bind(&id)
    .bind(&fixture.team_id)
    .bind(&protected)
    .execute(&db.pool)
    .await
    .unwrap();
    let application = app(&db);
    let path = format!("/datasets/{id}/sharingToken");
    let (a, b) = tokio::join!(
        request(&application, "GET", &path, Some(&member.token), None),
        request(&application, "GET", &path, Some(&member.token), None)
    );
    assert_eq!(a.0, StatusCode::OK, "{}", a.1);
    assert_eq!(a.1, b.1);
    let token = a.1["sharingToken"].as_str().unwrap();
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("/datasets/{id}?sharingToken={token}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, updated) = request(
        &application,
        "PATCH",
        &format!("/datasets/{id}/teams"),
        Some(&member.token),
        Some(json!([fixture.team_id, fixture.team_id, object_id()])),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated, json!([fixture.team_id, protected]));
    sqlx::query("UPDATE webknossos.user_team_roles SET isTeamManager=false WHERE _user=$1")
        .bind(&member.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(&application, "DELETE", &path, Some(&member.token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&application, "DELETE", &path, Some(&fixture.token), None)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("/datasets/{id}?sharingToken={token}"),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, invalid) = request(
        &application,
        "GET",
        "/datasets/.bad/isValidNewName",
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(invalid["isValid"], false);
    assert_eq!(
        request(
            &application,
            "GET",
            "/datasets/good-name/isValidNewName",
            Some(&fixture.token),
            None
        )
        .await
        .1,
        json!({"isValid":true})
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn stored_transform_and_axis_order_payloads_are_typed_and_canonicalized() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed_dataset(&db, &fixture, "Typed_layers", true).await;
    sqlx::query("UPDATE webknossos.datasets SET isUsable=true,voxelSizeFactor=ROW(1,1,1)::webknossos.VECTOR3 WHERE _id=$1").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat,mappings) VALUES ($1,'seg','segmentation','uint8',ROW(0,0,0,1,1,1)::webknossos.BOUNDING_BOX,'zarr3',ARRAY['a','a','b'])").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,axisOrder) VALUES ($1,'seg',ROW(1,1,1)::webknossos.VECTOR3,'{\"x\":1.0,\"y\":0,\"z\":null,\"c\":null,\"extra\":9}')").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_coordinateTransformations (_dataset,layerName,type,matrix,correspondences) VALUES ($1,'seg','affine','[[1,0],[0,1]]','{\"ignored\":true}')").bind(&id).execute(&db.pool).await.unwrap();
    let application = app(&db);
    let path = format!("/datasets/{id}");
    let (status, full) = request(&application, "GET", &path, None, None).await;
    assert_eq!(status, StatusCode::OK, "{full}");
    let layer = &full["dataSource"]["dataLayers"][0];
    assert_eq!(layer["mags"][0]["axisOrder"], json!({"x":1,"y":0}));
    assert_eq!(layer["mappings"], json!(["a", "b"]));
    assert_eq!(
        layer["coordinateTransformations"],
        json!([{"type":"affine","matrix":[[1,0],[0,1]]}])
    );
    sqlx::query("UPDATE webknossos.dataset_mags SET axisOrder='{\"x\":\"invalid\",\"y\":0}' WHERE _dataset=$1").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.dataset_layer_coordinateTransformations SET type='thin_plate_spline',correspondences='{\"source\":[[1,2,3]],\"target\":[[4,5,6]],\"extra\":9}' WHERE _dataset=$1").bind(&id).execute(&db.pool).await.unwrap();
    let (status, full) = request(&application, "GET", &path, None, None).await;
    assert_eq!(status, StatusCode::OK, "{full}");
    let layer = &full["dataSource"]["dataLayers"][0];
    assert!(layer["mags"][0].get("axisOrder").is_none());
    assert_eq!(
        layer["coordinateTransformations"],
        json!([{"type":"thin_plate_spline","correspondences":{"source":[[1,2,3]],"target":[[4,5,6]]}}])
    );
    for (typ, matrix, correspondences) in [
        ("unknown", Some(json!([[1]])), None),
        ("affine", None, None),
        ("affine", Some(json!([["bad"]])), None),
        (
            "thin_plate_spline",
            None,
            Some(json!({"source":[[1,2]],"target":[[1,2,3]]})),
        ),
    ] {
        sqlx::query("UPDATE webknossos.dataset_layer_coordinateTransformations SET type=$2,matrix=$3,correspondences=$4 WHERE _dataset=$1")
            .bind(&id).bind(typ).bind(matrix).bind(correspondences).execute(&db.pool).await.unwrap();
        assert_eq!(
            request(&application, "GET", &path, None, None).await.0,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn metadata_settings_access_lists_and_raw_superuser_sources_preserve_permissions() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed_dataset(&db, &fixture, "Settings_dataset", false).await;
    let manager = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let member = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let unlisted = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    let deactivated = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    for (user, manage) in [
        (&manager, true),
        (&member, false),
        (&unlisted, false),
        (&deactivated, false),
    ] {
        sqlx::query(
            "INSERT INTO webknossos.user_team_roles (_user,_team,isTeamManager) VALUES ($1,$2,$3)",
        )
        .bind(&user.user_id)
        .bind(&fixture.team_id)
        .bind(manage)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    sqlx::query("UPDATE webknossos.users SET isUnlisted=true WHERE _id=$1")
        .bind(&unlisted.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.users SET isDeactivated=true WHERE _id=$1")
        .bind(&deactivated.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_allowedTeams (_dataset,_team) VALUES ($1,$2)")
        .bind(&id)
        .bind(&fixture.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.datasets SET isUsable=true,voxelSizeFactor=ROW(1,1,1)::webknossos.VECTOR3,metadata='[{\"key\":\"existing\",\"value\":1}]',sortingKey=NOW()-INTERVAL '2 days' WHERE _id=$1").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox,dataFormat) VALUES ($1,'color','color','uint8',ROW(0,0,0,1,1,1)::webknossos.BOUNDING_BOX,'wkw')").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags (_dataset,dataLayerName,mag,credentialId) VALUES ($1,'color',ROW(1,1,1)::webknossos.VECTOR3,'mag-credential-reference')").bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments (_dataset,layerName,name,path,type,dataFormat,credentialId) VALUES ($1,'color','mesh','relative','mesh','hdf5','attachment-credential-reference')").bind(&id).execute(&db.pool).await.unwrap();
    let application = app(&db);
    let access_path = format!("/datasets/{id}/accessList");
    let (member_status, member_list) =
        request(&application, "GET", &access_path, Some(&member.token), None).await;
    assert_eq!(member_status, StatusCode::OK, "{member_list}");
    assert_eq!(member_list.as_array().unwrap().len(), 1);
    assert_eq!(member_list[0]["id"], member.user_id);
    let (status, manager_list) = request(
        &application,
        "GET",
        &access_path,
        Some(&manager.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{manager_list}");
    let ids = manager_list
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(ids.contains(&manager.user_id.as_str()) && ids.contains(&member.user_id.as_str()));
    assert!(
        !ids.contains(&fixture.user_id.as_str())
            && !ids.contains(&unlisted.user_id.as_str())
            && !ids.contains(&deactivated.user_id.as_str())
    );
    assert!(manager_list[0].get("organization").is_none());
    assert_eq!(
        request(
            &application,
            "PATCH",
            &format!("/datasets/{id}"),
            Some(&member.token),
            Some(json!({"name":"Denied","isPublic":false,"tags":[]}))
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, updated) = request(
        &application,
        "PATCH",
        &format!("/datasets/{id}"),
        Some(&manager.token),
        Some(json!({"name":"Ignored","displayName":"Displayed","isPublic":true,"tags":["new"]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["name"], "Displayed");
    assert_eq!(updated["directoryName"], "Settings_dataset");
    assert!(updated["description"].is_null());
    assert_eq!(updated["metadata"], json!([{"key":"existing","value":1}]));
    assert_eq!(updated["sortingKey"], updated["created"]);
    assert!(
        updated["dataSource"]["dataLayers"][0]["mags"][0]
            .get("credentialId")
            .is_none()
    );
    assert_eq!(request(&application,"PATCH",&format!("/datasets/{id}"),Some(&fixture.token),Some(json!({"name":"Duplicate","isPublic":true,"tags":[],"metadata":[{"key":"same"},{"nested":{"key":"same"}}]}))).await.0,StatusCode::BAD_REQUEST);
    assert_eq!(
        request(
            &application,
            "PATCH",
            &format!("/datasets/{id}"),
            Some(&fixture.token),
            Some(json!({"isPublic":true,"tags":[]}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let foreign = db.fixture().await;
    let foreign_folder: String =
        sqlx::query_scalar("SELECT _rootFolder FROM webknossos.organizations WHERE _id=$1")
            .bind(&foreign.organization_id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        request(
            &application,
            "PATCH",
            &format!("/datasets/{id}"),
            Some(&fixture.token),
            Some(
                json!({"name":"Foreign_folder","isPublic":true,"tags":[],"folderId":foreign_folder})
            )
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let raw_path = format!("/datasets/{id}/dataSourceForSuperUser");
    assert_eq!(
        request(&application, "GET", &raw_path, Some(&fixture.token), None)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=true WHERE _id=$1")
        .bind(&foreign.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, raw) = request(&application, "GET", &raw_path, Some(&foreign.token), None).await;
    assert_eq!(status, StatusCode::OK, "{raw}");
    assert_eq!(
        raw["dataLayers"][0]["mags"][0]["credentialId"],
        "mag-credential-reference"
    );
    assert_eq!(
        raw["dataLayers"][0]["attachments"]["meshes"][0]["credentialId"],
        "attachment-credential-reference"
    );
    assert!(raw["dataLayers"][0]["mags"][0].get("credentials").is_none());
    let (_, public) = request(&application, "GET", &format!("/datasets/{id}"), None, None).await;
    assert!(!public.to_string().contains("credential-reference"));
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn dataset_lookup_routes_filter_imports_and_test_alternate_identity_access_without_switching()
{
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed_dataset(&db, &fixture, "Original_directory", true).await;
    let later = seed_dataset(&db, &fixture, "Later_directory", true).await;
    sqlx::query("UPDATE webknossos.datasets SET name='Visible alias',importURL='http://example.test/import',created='2010-01-01' WHERE _id=$1")
        .bind(&id).execute(&db.pool).await.unwrap();
    sqlx::query("UPDATE webknossos.datasets SET importURL='http://example.test/import',created='2011-01-01' WHERE _id=$1")
        .bind(&later).execute(&db.pool).await.unwrap();
    let foreign = db.fixture().await;
    let foreign_id = seed_dataset(&db, &foreign, "Private_foreign", false).await;
    sqlx::query("UPDATE webknossos.datasets SET sharingToken='foreign-share',importURL='http://example.test/import',created='2000-01-01' WHERE _id=$1")
        .bind(&foreign_id).execute(&db.pool).await.unwrap();
    let application = app(&db);
    assert_eq!(
        request(
            &application,
            "GET",
            "/datasets/disambiguate/Visible%20alias/toNew",
            None,
            None
        )
        .await,
        (
            StatusCode::OK,
            json!({"organization":fixture.organization_id})
        )
    );
    let path = format!(
        "/datasets/disambiguate/{}/Original_directory/toId",
        fixture.organization_id
    );
    assert_eq!(
        request(&application, "GET", &path, None, None).await,
        (
            StatusCode::OK,
            json!({"id":id,"name":"Visible alias","organization":fixture.organization_id,"directoryName":"Original_directory"})
        )
    );
    assert_eq!(
        request(
            &application,
            "GET",
            &format!(
                "/datasets/disambiguate/{}/Visible%20alias/toId",
                fixture.organization_id
            ),
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (status, imported) = request(
        &application,
        "GET",
        "/datasets/findByImportURL?importURL=http%3A%2F%2Fexample.test%2Fimport",
        Some(&fixture.token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{imported}");
    assert_eq!(imported["id"], id);
    assert_eq!(
        request(
            &application,
            "GET",
            "/datasets/findByImportURL?importURL=missing",
            Some(&fixture.token),
            None
        )
        .await,
        (StatusCode::OK, Value::Null)
    );
    assert_eq!(
        request(
            &application,
            "GET",
            "/datasets/findByImportURL",
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let private_path = format!(
        "/datasets/disambiguate/{}/Private_foreign/toId",
        foreign.organization_id
    );
    assert_eq!(
        request(
            &application,
            "GET",
            &private_path,
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("{private_path}?sharingToken=foreign-share"),
            None,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &application,
            "GET",
            "/datasets/disambiguate/Private_foreign/toNew?sharingToken=foreign-share",
            None,
            None
        )
        .await,
        (
            StatusCode::OK,
            json!({"organization":foreign.organization_id})
        )
    );
    sqlx::query("UPDATE webknossos.users SET _multiUser=$2 WHERE _id=$1")
        .bind(&foreign.user_id)
        .bind(&fixture.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &application,
            "GET",
            &private_path,
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    // The lookup proves alternate identity access, but never switches identity.
    assert_eq!(
        request(
            &application,
            "GET",
            &format!("/datasets/{foreign_id}"),
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.users SET isDeactivated=true WHERE _id=$1")
        .bind(&foreign.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &application,
            "GET",
            &private_path,
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.multiUsers SET isSuperUser=true WHERE _id=$1")
        .bind(&fixture.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &application,
            "GET",
            &private_path,
            Some(&fixture.token),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires isolated PostgreSQL database with CREATEDB"]
async fn metadata_updates_render_before_commit_and_work_with_one_database_connection() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    let id = seed_dataset(&db, &fixture, "Atomic_settings", false).await;
    let manager = db
        .seed_user(&object_id(), &fixture.organization_id, false)
        .await;
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles (_user,_team,isTeamManager) VALUES ($1,$2,true)",
    )
    .bind(&manager.user_id)
    .bind(&fixture.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let mut folders = Vec::new();
    for name in ["Allowed", "Unrelated"] {
        let folder = object_id();
        sqlx::query("INSERT INTO webknossos.folders (_id,name) VALUES ($1,$2)")
            .bind(&folder)
            .bind(name)
            .execute(&db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO webknossos.folder_paths (_ancestor,_descendant,depth) SELECT _rootFolder,$2,1 FROM webknossos.organizations WHERE _id=$1 UNION ALL SELECT $2,$2,0")
            .bind(&fixture.organization_id).bind(&folder).execute(&db.pool).await.unwrap();
        folders.push(folder);
    }
    sqlx::query("INSERT INTO webknossos.folder_allowedTeams (_folder,_team) VALUES ($1,$2)")
        .bind(&folders[0])
        .bind(&fixture.team_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.datasets SET _folder=$2,isUsable=true,voxelSizeFactor=ROW(1,1,1)::webknossos.VECTOR3 WHERE _id=$1")
        .bind(&id).bind(&folders[0]).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,boundingBox) VALUES ($1,'bad','color','uint8',ROW(0,0,0,1,1,1)::webknossos.BOUNDING_BOX)")
        .bind(&id).execute(&db.pool).await.unwrap();
    let single = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&db.connection_url())
        .await
        .unwrap();
    let application = datasets::metadata_router(false)
        .layer(axum::Extension(offline_misc()))
        .with_state(AppState {
            pool: single.clone(),
        });
    let path = format!("/datasets/{id}");
    let (status, result) = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        request(
            &application,
            "PATCH",
            &path,
            Some(&manager.token),
            Some(json!({"name":"Must_rollback","isPublic":false,"tags":["changed"]})),
        ),
    )
    .await
    .expect("metadata update must not acquire nested pool connections");
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{result}");
    let (name, tags): (String, Vec<String>) =
        sqlx::query_as("SELECT name,tags FROM webknossos.datasets WHERE _id=$1")
            .bind(&id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(name, "Atomic_settings");
    assert!(tags.is_empty());
    sqlx::query("UPDATE webknossos.dataset_layers SET dataFormat='wkw' WHERE _dataset=$1")
        .bind(&id)
        .execute(&db.pool)
        .await
        .unwrap();
    let (status, result) = request(
        &application,
        "PATCH",
        &path,
        Some(&manager.token),
        Some(json!({"name":"Move_loses_access","isPublic":false,"tags":[],"folderId":folders[1]})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{result}");
    let (name, folder): (String, String) =
        sqlx::query_as("SELECT name,_folder FROM webknossos.datasets WHERE _id=$1")
            .bind(&id)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(
        (name, folder),
        ("Atomic_settings".to_owned(), folders[0].clone())
    );
    for timestamp in [
        json!(1577836800000_i64),
        json!("1577836800000"),
        json!("2020-01-01T00:00:00Z"),
    ] {
        let (status,result)=tokio::time::timeout(std::time::Duration::from_secs(3),request(&application,"PATCH",&path,Some(&manager.token),Some(json!({"name":"Atomic_settings","isPublic":false,"tags":[],"sortingKey":timestamp}))))
            .await.expect("metadata response rendering must use the transaction connection");
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["sortingKey"], 1577836800000_i64);
    }
    assert_eq!(
        request(
            &application,
            "PATCH",
            &path,
            Some(&manager.token),
            Some(
                json!({"name":"Atomic_settings","isPublic":false,"tags":[],"sortingKey":"invalid"})
            )
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    single.close().await;
    db.cleanup().await;
}
