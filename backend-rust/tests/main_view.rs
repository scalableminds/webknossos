//! The main view (AboutPageRedirectController + OpenGraphService) on the router's catch-all.
use crate::common::{TestDb, object_id};
use axum::{
    Router,
    body::Body,
    http::{Request, header},
};
use http_body_util::BodyExt;
use std::path::PathBuf;
use tower::ServiceExt;
use webknossos_backend::{
    AppState, main_view::MainViewConfig, router, system::application_info::MiscConfig,
};

const TEMPLATE: &str = r#"<html><head>
  <meta name="commit-hash" content="" />
  <meta name="selected-theme" content="" />
  <!-- INJECT_THEME_CSS -->
  <title>Loading | WEBKNOSSOS</title>
  <!-- INJECT_OPENGRAPH_METADATA -->
  <!-- INJECT_WKORG_METADATA -->
  <!-- INJECT_AIRBRAKE_CONFIG -->
</head></html>"#;

struct Page {
    status: u16,
    headers: axum::http::HeaderMap,
    body: String,
}

async fn get(app: &Router, uri: &str, token: Option<&str>) -> Page {
    let mut request = Request::builder().uri(uri);
    if let Some(token) = token {
        request = request.header("X-Auth-Token", token);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Page {
        status,
        headers,
        body: String::from_utf8(bytes.to_vec()).unwrap(),
    }
}

fn public_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("wk-main-view-{}", object_id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), TEMPLATE).unwrap();
    dir
}

fn app(db: &TestDb, misc: MiscConfig, main_view: MainViewConfig) -> Router {
    router(
        AppState::builder(db.pool.clone())
            .misc(misc)
            .main_view(main_view)
            .build(),
    )
}

fn misc() -> MiscConfig {
    MiscConfig {
        public_uri: "https://wk.example".into(),
        ..MiscConfig::default()
    }
}

fn og(property: &str, content: &str) -> String {
    format!(r#"<meta property="og:{property}" content="{content}" />"#)
}

async fn seed_dataset(db: &TestDb, organization_id: &str, name: &str, public: bool) -> String {
    sqlx::query(
        "INSERT INTO webknossos.dataStores (name,url,publicUrl,key) VALUES \
         ('test-store','http://localhost:9001','http://localhost:9002','secret-key') \
         ON CONFLICT DO NOTHING",
    )
    .execute(&db.pool)
    .await
    .unwrap();
    let id = object_id();
    sqlx::query(
        "INSERT INTO webknossos.datasets \
            (_id,_dataStore,_organization,_folder,name,directoryName,isUsable,isPublic,\
            voxelSizeFactor,sortingKey,sharingToken) SELECT $1,'test-store',_id,_rootFolder,$3,\
            $3,true,$4,ROW(1,1,1)::webknossos.VECTOR3,NOW(),'share-' || $1 \
            FROM webknossos.organizations WHERE _id=$2",
    )
    .bind(&id)
    .bind(organization_id)
    .bind(name)
    .bind(public)
    .execute(&db.pool)
    .await
    .unwrap();
    for (layer, category) in [
        ("segmentation", "segmentation"),
        ("z-color", "color"),
        ("color", "color"),
    ] {
        sqlx::query(
            "INSERT INTO webknossos.dataset_layers (_dataset,name,category,elementClass,\
             boundingBox,dataFormat) VALUES ($1,$2,$3::webknossos.DATASET_LAYER_CATEGORY,'uint8',\
             ROW(0,0,0,10,10,10)::webknossos.BOUNDING_BOX,'zarr3')",
        )
        .bind(&id)
        .bind(layer)
        .bind(category)
        .execute(&db.pool)
        .await
        .unwrap();
    }
    id
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn main_view_renders_open_graph_tags() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dir = public_dir();
    let app = app(
        &db,
        misc(),
        MainViewConfig {
            public_dir: dir.clone(),
            ..MainViewConfig::default()
        },
    );
    let logo = og("image", "https://wk.example/images/og-image.png");

    // Generic pages: default tags, theme by preference, HTML headers.
    let page = get(&app, "/dashboard", None).await;
    assert_eq!(page.status, 200, "{}", page.body);
    assert_eq!(
        page.headers[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    assert_eq!(page.headers[header::CACHE_CONTROL], "no-store");
    assert!(page.headers.contains_key(header::CONTENT_SECURITY_POLICY));
    assert!(page.body.contains(&og("title", "WEBKNOSSOS")));
    assert!(!page.body.contains("og:description"));
    assert!(page.body.contains(&logo));
    assert!(
        page.body
            .contains(r#"<meta name="selected-theme" content="auto" />"#)
    );
    assert!(page.body.contains("<title>WEBKNOSSOS</title>"));

    sqlx::query("UPDATE webknossos.multiUsers SET selectedTheme='dark' WHERE _id=$1")
        .bind(&f.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    let page = get(&app, "/", Some(&f.token)).await;
    assert!(
        page.body
            .contains(r#"<meta name="selected-theme" content="dark" />"#)
    );
    assert!(
        page.body
            .contains("<style>html { background: black }</style>")
    );
    // An unknown `?token=` (e.g. a private link) is ignored, as in Play's UserAwareAction.
    let page = get(&app, "/dashboard?token=not-a-user-token", None).await;
    assert_eq!(page.status, 200, "{}", page.body);

    // API and asset paths keep the JSON 404.
    for path in [
        "/api/nothing",
        "/assets/x.js",
        "/images/x.png",
        "/favicon.ico",
    ] {
        let page = get(&app, path, None).await;
        assert_eq!(page.status, 404, "{path}");
        assert!(page.body.starts_with('{'), "{path}: {}", page.body);
    }

    // A public dataset: name and the first color layer's thumbnail.
    let public = seed_dataset(&db, &f.organization_id, "public-ds", true).await;
    let thumbnail =
        format!("https://wk.example/api/datasets/{public}/layers/color/thumbnail?w=1000&amp;h=300");
    let page = get(&app, &format!("/datasets/public-ds-{public}/view"), None).await;
    assert!(
        page.body.contains(&og("title", "public-ds | WEBKNOSSOS")),
        "{}",
        page.body
    );
    assert!(
        page.body
            .contains(&og("description", "View this dataset in WEBKNOSSOS"))
    );
    assert!(page.body.contains(&og("image", &thumbnail)));
    let page = get(
        &app,
        &format!("/datasets/{}/public-ds", f.organization_id),
        None,
    )
    .await;
    assert!(
        page.body.contains(&og("image", &thumbnail)),
        "{}",
        page.body
    );

    // A private dataset: generic dataset tags, unless the sharing token grants access.
    let private = seed_dataset(&db, &f.organization_id, "private-ds", false).await;
    let path = format!("/datasets/private-ds-{private}/view");
    let page = get(&app, &path, None).await;
    assert!(
        page.body.contains(&og("title", "WEBKNOSSOS")),
        "{}",
        page.body
    );
    assert!(
        page.body
            .contains(&og("description", "View this dataset in WEBKNOSSOS"))
    );
    assert!(page.body.contains(&logo));
    let page = get(&app, &format!("{path}?sharingToken=share-{private}"), None).await;
    assert!(
        page.body.contains(&og("title", "private-ds | WEBKNOSSOS")),
        "{}",
        page.body
    );
    assert!(
        page.body
            .contains(&format!("&amp;sharingToken=share-{private}"))
    );
    let page = get(&app, &path, Some(&f.token)).await;
    assert!(page.body.contains(&og("title", "private-ds | WEBKNOSSOS")));

    // Annotations: public ones by name, otherwise the dataset's name.
    let annotation = object_id();
    sqlx::query(
        "INSERT INTO webknossos.annotations (_id,_dataset,_user,typ,visibility,name) VALUES \
         ($1,$2,$3,'Explorational','Public','My <tracing>')",
    )
    .bind(&annotation)
    .bind(&public)
    .bind(&f.user_id)
    .execute(&db.pool)
    .await
    .unwrap();
    let page = get(&app, &format!("/annotations/{annotation}"), None).await;
    assert!(
        page.body
            .contains(&og("title", "My &lt;tracing&gt; | WEBKNOSSOS")),
        "{}",
        page.body
    );
    assert!(page.body.contains(&og(
        "description",
        "View this annotation on dataset public-ds in WEBKNOSSOS"
    )));
    let page = get(&app, &format!("/annotations/{}", object_id()), None).await;
    assert!(
        page.body
            .contains(&og("description", "View this annotation in WEBKNOSSOS"))
    );

    // Short links resolve to the long link's page and token.
    sqlx::query("INSERT INTO webknossos.shortLinks (_id,key,longLink) VALUES ($1,'abc',$2)")
        .bind(object_id())
        .bind(format!("https://wk.example{path}?token=share-{private}"))
        .execute(&db.pool)
        .await
        .unwrap();
    let page = get(&app, "/links/abc", None).await;
    assert!(
        page.body.contains(&og("title", "private-ds | WEBKNOSSOS")),
        "{}",
        page.body
    );
    let page = get(&app, "/links/missing", None).await;
    assert!(page.body.contains(&og("title", "WEBKNOSSOS")));
    assert!(!page.body.contains("og:description"));

    std::fs::remove_dir_all(&dir).unwrap();
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB"]
async fn main_view_redirects_and_template_errors() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    let dir = public_dir();
    let wkorg = MiscConfig {
        is_wkorg_instance: true,
        ..misc()
    };
    let app = app(
        &db,
        wkorg,
        MainViewConfig {
            public_dir: dir.clone(),
            about_page_redirect_prefix: "https://home.example".into(),
            about_page_redirect_routes: vec!["/".into(), "/features*".into()],
            ..MainViewConfig::default()
        },
    );
    let page = get(&app, "/", None).await;
    assert_eq!(page.status, 303);
    assert_eq!(page.headers[header::LOCATION], "https://home.example/");
    // Logged-in users get the dashboard on `/`, but other redirect routes still redirect.
    assert_eq!(get(&app, "/", Some(&f.token)).await.status, 200);
    let page = get(&app, "/features/x?y=1", Some(&f.token)).await;
    assert_eq!(page.status, 301);
    assert_eq!(
        page.headers[header::LOCATION],
        "https://home.example/features/x?y=1"
    );
    let page = get(&app, "/dashboard", None).await;
    assert_eq!(page.status, 200);
    assert!(page.body.contains(r#"name="keywords""#));
    let page = get(&app, "/sw.123.js", None).await;
    assert_eq!((page.status, page.body.as_str()), (200, ""));
    assert_eq!(page.headers[header::CONTENT_TYPE], "text/javascript");

    let missing = app_without_template(&db);
    let page = get(&missing, "/dashboard", None).await;
    assert_eq!(page.status, 400);
    assert!(
        page.body.contains("Could not load main view template"),
        "{}",
        page.body
    );

    std::fs::remove_dir_all(&dir).unwrap();
    db.cleanup().await;
}

fn app_without_template(db: &TestDb) -> Router {
    app(
        db,
        misc(),
        MainViewConfig {
            public_dir: std::env::temp_dir().join(format!("wk-missing-{}", object_id())),
            ..MainViewConfig::default()
        },
    )
}
