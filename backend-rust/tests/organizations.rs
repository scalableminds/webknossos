mod common;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use common::{Fixture, TestDb, object_id};
use serde_json::{Value, json};
use tower::ServiceExt;
use webknossos_backend::{AppState, organizations};

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
                .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn app(db: &TestDb) -> Router {
    organizations::router().with_state(AppState {
        pool: db.pool.clone(),
    })
}
async fn seed_billing(db: &TestDb, f: &Fixture) {
    sqlx::query("UPDATE webknossos.users SET isorganizationowner=true WHERE _id=$1")
        .bind(&f.user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE webknossos.organizations SET additionalinformation='Public information',newusermailinglist='private@example.test',lasttermsofserviceacceptanceversion=7,lasttermsofserviceacceptancetime='2026-01-01T00:00:00Z',pricingplan='Team',aiplan='Team_AI',includedusers=10,includedstorage=100000,paiduntil='2027-01-01T00:00:00Z' WHERE _id=$1")
        .bind(&f.organization_id).execute(&db.pool).await.unwrap();
    for (delta, deleted) in [(1000, false), (-200, false), (8000, true)] {
        sqlx::query("INSERT INTO webknossos.credit_transactions(_id,_organization,milli_credit_delta,comment,transaction_state,credit_state,is_deleted) VALUES($1,$2,$3,'test','Complete','AddCredits',$4)")
            .bind(object_id()).bind(&f.organization_id).bind(delta).bind(deleted).execute(&db.pool).await.unwrap();
    }
    let dataset = object_id();
    sqlx::query("INSERT INTO webknossos.datastores(name,url,publicurl,key) VALUES('rust-test','http://localhost:9000','http://localhost:9000','key')").execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.datasets(_id,_datastore,_organization,_folder,name,directoryname,sortingkey) SELECT $1,'rust-test',_id,_rootfolder,'Test dataset','test',now() FROM webknossos.organizations WHERE _id=$2")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layers(_dataset,name,category,elementclass,boundingbox) VALUES($1,'layer','segmentation','uint8',ROW(0,0,0,10,10,10)::webknossos.bounding_box)")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_mags(_dataset,datalayername,mag) VALUES($1,'layer',ROW(1,1,1)::webknossos.vector3)")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.dataset_layer_attachments(_dataset,layername,name,path,type,dataformat) VALUES($1,'layer','mesh','test','mesh','json')")
        .bind(&dataset).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedstorage_mags(_dataset,layername,mag,path,_organization,usedstoragebytes) VALUES($1,'layer',ROW(1,1,1)::webknossos.vector3,'test',$2,123)")
        .bind(&dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO webknossos.organization_usedstorage_attachments(_dataset,layername,name,path,type,_organization,usedstoragebytes) VALUES($1,'layer','mesh','test','mesh',$2,456)")
        .bind(dataset).bind(&f.organization_id).execute(&db.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn organization_public_json_privacy_and_billing_aggregates() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    seed_billing(&db, &f).await;
    let app = app(&db);
    let path = format!("/organizations/{}", f.organization_id);
    let (code, public) = request(&app, "GET", &path, None, None).await;
    assert_eq!(code, StatusCode::OK, "{public}");
    assert_eq!(public["ownerName"], "Rust Test");
    assert_eq!(public["usedStorageBytes"], 579);
    assert_eq!(public["milliCreditBalance"], Value::Null);
    assert_eq!(public["pricingPlan"], "Team");
    assert_eq!(public["aiPlan"], "Team_AI");
    assert_eq!(public["paidUntil"], 1798761600000i64);
    assert_eq!(public["includedUsers"], 10);
    for hidden in [
        "newUserMailingList",
        "lastTermsOfServiceAcceptanceTime",
        "lastTermsOfServiceAcceptanceVersion",
        "logoUrl",
        "_rootFolder",
        "created",
    ] {
        assert!(public.get(hidden).is_none(), "{hidden}");
    }
    let (_, admin) = request(&app, "GET", &path, Some(&f.token), None).await;
    assert_eq!(admin["milliCreditBalance"], 800);
    assert_eq!(admin["newUserMailingList"], "private@example.test");
    assert_eq!(admin["lastTermsOfServiceAcceptanceVersion"], 7);
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let (_, member_json) = request(&app, "GET", &path, Some(&member.token), None).await;
    assert_eq!(member_json["milliCreditBalance"], 0);
    assert!(member_json.get("newUserMailingList").is_none());
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user,_team,isteammanager) VALUES($1,$2,true)",
    )
    .bind(&member.user_id)
    .bind(&f.team_id)
    .execute(&db.pool)
    .await
    .unwrap();
    assert_eq!(
        request(&app, "GET", &path, Some(&member.token), None)
            .await
            .1["milliCreditBalance"],
        800
    );
    let (_, listed) = request(&app, "GET", "/organizations", Some(&f.token), None).await;
    assert_eq!(listed[0], public);
    let (_, compact) = request(
        &app,
        "GET",
        "/organizations?compact=true",
        Some(&f.token),
        None,
    )
    .await;
    assert_eq!(
        compact,
        json!([{"id":f.organization_id,"name":"Test organization"}])
    );
    assert_eq!(
        request(&app, "GET", "/organizations", None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn default_invite_and_account_organization_listing() {
    let db = TestDb::new().await;
    let app = app(&db);
    assert_eq!(
        request(&app, "GET", "/organizationsIsEmpty", None, None)
            .await
            .1,
        true
    );
    assert_eq!(
        request(&app, "GET", "/organizations/default", None, None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let f = db.fixture().await;
    assert_eq!(
        request(&app, "GET", "/organizationsIsEmpty", None, None)
            .await
            .1,
        false
    );
    assert_eq!(
        request(&app, "GET", "/organizations/default", None, None)
            .await
            .1["id"],
        f.organization_id
    );
    sqlx::query("INSERT INTO webknossos.invites(_id,tokenvalue,_organization,autoactivate,expirationdatetime) VALUES($1,'valid-invite',$2,true,now()+interval '1 hour'),($3,'expired-invite',$2,true,now()-interval '1 hour')")
        .bind(object_id()).bind(&f.organization_id).bind(object_id()).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            "GET",
            "/organizations/byInvite/valid-invite",
            None,
            None
        )
        .await
        .1["id"],
        f.organization_id
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/organizations/byInvite/expired-invite",
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    sqlx::query("UPDATE webknossos.invites SET isdeleted=true WHERE tokenvalue='valid-invite'")
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &app,
            "GET",
            "/organizations/byInvite/valid-invite",
            None,
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let other = db.seed_user(&object_id(), "other-rust-org", true).await;
    assert_eq!(
        request(&app, "GET", "/organizations/default", None, None)
            .await
            .1,
        Value::Null
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/organizations?compact=true",
            Some(&f.token),
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        1
    );
    // A second identity of the same account makes its organization listable.
    sqlx::query("INSERT INTO webknossos.users(_id,_multiuser,_organization,userconfiguration) VALUES($1,$2,$3,'{}')")
        .bind(object_id()).bind(&f.multi_user_id).bind(&other.organization_id).execute(&db.pool).await.unwrap();
    assert_eq!(
        request(
            &app,
            "GET",
            "/organizations?compact=true",
            Some(&f.token),
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        2
    );
    let third = db.seed_user(&object_id(), "third-rust-org", true).await;
    assert_eq!(
        request(
            &app,
            "GET",
            "/organizations?compact=true",
            Some(&f.token),
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        2
    );
    sqlx::query("UPDATE webknossos.multiusers SET issuperuser=true WHERE _id=$1")
        .bind(&f.multi_user_id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(
        request(
            &app,
            "GET",
            "/organizations?compact=true",
            Some(&f.token),
            None
        )
        .await
        .1
        .as_array()
        .unwrap()
        .len(),
        3
    );
    // An admin from another organization gets only the public organization view.
    let (_, foreign) = request(
        &app,
        "GET",
        &format!("/organizations/{}", third.organization_id),
        Some(&f.token),
        None,
    )
    .await;
    assert_eq!(foreign["milliCreditBalance"], Value::Null);
    assert!(foreign.get("newUserMailingList").is_none());
    db.cleanup().await;
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB; run cargo test -- --ignored"]
async fn organization_patch_is_admin_only_and_preserves_billing_and_root() {
    let db = TestDb::new().await;
    let f = db.fixture().await;
    seed_billing(&db, &f).await;
    let member = db.seed_user(&object_id(), &f.organization_id, false).await;
    let other = db.seed_user(&object_id(), "other-rust-org", true).await;
    let app = app(&db);
    let path = format!("/organizations/{}", f.organization_id);
    let immutable:Value=sqlx::query_scalar("SELECT jsonb_build_object('root',_rootfolder,'pricingPlan',pricingplan,'aiPlan',aiplan,'includedUsers',includedusers,'includedStorage',includedstorage,'paidUntil',paiduntil,'tosVersion',lasttermsofserviceacceptanceversion) FROM webknossos.organizations WHERE _id=$1")
        .bind(&f.organization_id).fetch_one(&db.pool).await.unwrap();
    let body = json!({"name":"Renamed organization","newUserMailingList":"new@example.test","pricingPlan":"Personal","includedStorageBytes":1,"_rootFolder":object_id()});
    assert_eq!(
        request(
            &app,
            "PATCH",
            &path,
            Some(&member.token),
            Some(body.clone())
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(&app, "PATCH", &path, Some(&other.token), Some(body.clone()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (code, value) = request(&app, "PATCH", &path, Some(&f.token), Some(body)).await;
    assert_eq!(code, StatusCode::OK, "{value}");
    assert_eq!(value["name"], "Renamed organization");
    assert_eq!(value["newUserMailingList"], "new@example.test");
    let after:Value=sqlx::query_scalar("SELECT jsonb_build_object('root',_rootfolder,'pricingPlan',pricingplan,'aiPlan',aiplan,'includedUsers',includedusers,'includedStorage',includedstorage,'paidUntil',paiduntil,'tosVersion',lasttermsofserviceacceptanceversion) FROM webknossos.organizations WHERE _id=$1")
        .bind(&f.organization_id).fetch_one(&db.pool).await.unwrap();
    assert_eq!(immutable, after);
    assert_eq!(
        request(
            &app,
            "PATCH",
            &path,
            Some(&f.token),
            Some(json!({"name":"Missing mailing list"}))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    db.cleanup().await;
}
