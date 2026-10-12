mod common;

use axum::{body::Bytes, http::StatusCode};
use common::{TestDb, object_id};
use webknossos_backend::{
    annotation_upload_service::{
        ExtractionLimits, MSG_DIFFERENT_DATASETS, PgDatasetLookup, extract_from_files,
        find_dataset_for_uploaded_annotations, find_one_by_id_or_name_and_organization,
    },
    nml_parser::{NmlParseResult, SharedParsingParameters},
    proto::datastore::SkeletonTracing,
};

async fn seed_dataset(
    db: &TestDb,
    organization_id: &str,
    name: &str,
    directory_name: &str,
) -> String {
    let id = object_id();
    sqlx::query(
        "INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, name, directoryName, sortingKey)
         SELECT $1, 'store', _id, _rootFolder, $3, $4, NOW() FROM webknossos.organizations WHERE _id = $2",
    )
    .bind(&id)
    .bind(organization_id)
    .bind(name)
    .bind(directory_name)
    .execute(&db.pool)
    .await
    .expect("Cannot seed dataset");
    id
}

fn skeleton(organization_id: &str) -> SkeletonTracing {
    SkeletonTracing {
        organization_id: Some(organization_id.to_owned()),
        ..Default::default()
    }
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn dataset_lookups_follow_scala_semantics_and_read_access() {
    let db = TestDb::new().await;
    let admin = db.fixture().await;
    let org = admin.organization_id.clone();
    let viewer = object_id();
    db.seed_user(&viewer, &org, false).await;
    sqlx::query("INSERT INTO webknossos.dataStores (name, url, publicUrl, key) VALUES ('store', 'https://data.example.test', 'https://data.example.test', 'k')")
        .execute(&db.pool)
        .await
        .expect("Cannot seed datastore");
    let by_dir = seed_dataset(&db, &org, "Display", "dir_a").await;
    let unique = seed_dataset(&db, &org, "Unique", "dir_b").await;
    seed_dataset(&db, &org, "Twin", "dir_c").await;
    seed_dataset(&db, &org, "Twin", "dir_d").await;
    let pool = &db.pool;
    let find = |user: &str, id: Option<&str>, name: &str| {
        let (pool, user, id, name, org) = (
            pool.clone(),
            user.to_owned(),
            id.map(str::to_owned),
            name.to_owned(),
            org.clone(),
        );
        async move {
            find_one_by_id_or_name_and_organization(&pool, &user, id.as_deref(), &name, &org)
                .await
                .unwrap()
                .map(|d| d.id)
        }
    };

    assert_eq!(
        find(&admin.user_id, Some(&unique), "ignored").await,
        Ok(unique.clone())
    );
    let missing = object_id();
    assert_eq!(
        find(&admin.user_id, Some(&missing), "x").await,
        Err(format!(
            "Dataset “{missing}” could not be found or accessed."
        ))
    );
    assert_eq!(
        find(&admin.user_id, None, "dir_a").await,
        Ok(by_dir.clone())
    );
    assert_eq!(
        find(&admin.user_id, None, "Unique").await,
        Ok(unique.clone())
    );
    assert_eq!(
        find(&admin.user_id, None, "Twin").await,
        Err("Dataset with name “Twin” could not be found or accessed. <~ Multiple datasets with this name exist in this organization. Specify dataset id to select correct one.".to_owned())
    );
    // A non-admin without team access cannot read private datasets.
    assert_eq!(
        find(&viewer, Some(&unique), "x").await,
        Err(format!(
            "Dataset “{unique}” could not be found or accessed."
        ))
    );
    assert_eq!(
        find(&viewer, None, "dir_a").await,
        Err("Dataset with name “dir_a” could not be found or accessed.".to_owned())
    );

    // findDatasetForUploadedAnnotations
    let host = "http://localhost:9000";
    let own = skeleton(&org);
    let found = find_dataset_for_uploaded_annotations(
        pool,
        &admin.user_id,
        host,
        &[&own],
        &[],
        &[&unique],
        "",
    )
    .await
    .unwrap();
    assert_eq!(
        (found.id.as_str(), found.name.as_str()),
        (unique.as_str(), "Unique")
    );
    let error = find_dataset_for_uploaded_annotations(
        pool,
        &admin.user_id,
        host,
        &[&own],
        &[],
        &[&unique, &by_dir],
        "",
    )
    .await
    .unwrap_err();
    assert_eq!(
        (error.status, error.message.as_str()),
        (StatusCode::BAD_REQUEST, MSG_DIFFERENT_DATASETS)
    );
    let foreign = skeleton("no-such-org");
    let error = find_dataset_for_uploaded_annotations(
        pool,
        &admin.user_id,
        host,
        &[&foreign],
        &[],
        &[&unique],
        "https://other.example",
    )
    .await
    .unwrap_err();
    assert_eq!(error.status, StatusCode::NOT_FOUND);
    assert_eq!(
        error.message,
        "Organization “no-such-org” could not be found or accessed. Please check whether you are on the correct WEBKNOSSOS instance. The uploaded file indicates “https://other.example” while this instance is “http://localhost:9000”."
    );
    let error =
        find_dataset_for_uploaded_annotations(pool, &viewer, host, &[&own], &[], &[&unique], host)
            .await
            .unwrap_err();
    assert_eq!(
        (error.status, error.message),
        (
            StatusCode::FORBIDDEN,
            format!("Dataset “{unique}” could not be found or accessed.")
        )
    );
    let other = db.fixture().await;
    let other_org = skeleton(&other.organization_id);
    let error = find_dataset_for_uploaded_annotations(
        pool,
        &admin.user_id,
        host,
        &[&other_org],
        &[],
        &[&unique],
        "",
    )
    .await
    .unwrap_err();
    assert_eq!(error.status, StatusCode::FORBIDDEN);
    let no_org = SkeletonTracing::default();
    let found = find_dataset_for_uploaded_annotations(
        pool,
        &admin.user_id,
        host,
        &[&no_org],
        &[],
        &[&unique],
        "",
    )
    .await
    .unwrap();
    assert_eq!(found.organization_id, org);

    // End to end: an NML referencing the dataset by id and by directory name.
    let nml = |experiment: &str| {
        Bytes::from(format!(
            r#"<things><parameters><experiment {experiment}/></parameters><thing id="1" name="t"><nodes><node id="1" x="1" y="1" z="1"/></nodes></thing></things>"#
        ))
    };
    let lookup = PgDatasetLookup {
        pool: pool.clone(),
        user_id: admin.user_id.clone(),
    };
    let result = extract_from_files(
        vec![
            (
                "by-id.nml".to_owned(),
                nml(&format!(
                    r#"name="x" datasetId="{}""#,
                    unique.to_uppercase()
                )),
            ),
            ("by-dir.nml".to_owned(), nml(r#"name="dir_a""#)),
            ("bad-id.nml".to_owned(), nml(r#"name="x" datasetId="nope""#)),
        ],
        SharedParsingParameters {
            user_organization_id: org.clone(),
            ..Default::default()
        },
        true,
        ExtractionLimits::default(),
        &lookup,
    )
    .await
    .unwrap();
    let datasets: Vec<Result<String, String>> = result
        .parse_results
        .iter()
        .map(|r| match r {
            NmlParseResult::Success { success, .. } => Ok(success.dataset_id.clone()),
            NmlParseResult::Failure { error, .. } => Err(error.clone()),
            NmlParseResult::Empty { .. } => Err("empty".to_owned()),
        })
        .collect();
    assert_eq!(
        datasets,
        vec![
            Ok(unique.clone()),
            Ok(by_dir.clone()),
            Err("The supplied resource id “nope” is not a valid ObjectId.".to_owned())
        ]
    );
    db.cleanup().await;
}
