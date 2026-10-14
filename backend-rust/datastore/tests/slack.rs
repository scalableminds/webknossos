mod mock_wk;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use mock_wk::{MockWk, Reply};
use serde_json::json;
use tower::ServiceExt;
use webknossos_datastore::{AppState, config::Secret, router, slack::SlackNotifications};

async fn wait_for_calls(server: &MockWk, count: usize) {
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while server.calls().len() < count {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn attachments_rate_limit_and_internal_health_hook_use_local_webhook() {
    let webhook = MockWk::start(|call| {
        assert_eq!(call.method, "POST");
        Reply::text(StatusCode::OK, "ok")
    })
    .await;
    let mut config = webhook.config();
    config.http.uri = "https://user:password@datastore.example?token=secret".into();
    config.slack_notifications.uri = Secret::new(webhook.uri());
    let state = AppState::new(config);
    state.health.push("secret internal error detail");
    state.slack.slow_request(
        "POST",
        "/data/datasets/test?token=secret",
        std::time::Duration::from_secs(601),
        200,
    );
    state
        .slack
        .failed_upload("/data/datasets/upload/dataset?key=secret", 403);
    wait_for_calls(&webhook, 3).await;
    let calls = webhook.calls();
    assert!(calls.iter().any(|c| c.json() == json!({"attachments":[{
        "title":"Slow request reported from WEBKNOSSOS datastore at https://datastore.example/",
        "text":"Request `POST` `/data/datasets/test` took 601000 ms and was successful", "color":"#333ccc"
    }]})));
    assert!(calls.iter().any(|c| {
        c.json()["attachments"][0]["title"]
            .as_str()
            .unwrap()
            .starts_with("Internal Error")
    }));
    assert!(
        calls
            .iter()
            .any(|c| c.json()["attachments"][0]["color"] == "#ff8a00")
    );
    assert!(
        calls
            .iter()
            .all(|c| !String::from_utf8_lossy(&c.body).contains("secret"))
    );
    for _ in 0..40 {
        state.slack.failed_upload("/data/upload", 500);
    }
    wait_for_calls(&webhook, 30).await;
    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    assert_eq!(webhook.calls().len(), 30);
}

#[tokio::test]
async fn disabled_webhook_is_silent_and_upload_form_error_reports() {
    let webhook = MockWk::start(|_| Reply::text(StatusCode::OK, "ok")).await;
    let mut config = webhook.config();
    let disabled = SlackNotifications::new(&config);
    disabled.failed_upload("/data/upload", 500);
    assert!(webhook.calls().is_empty());
    config.slack_notifications.uri = Secret::new(webhook.uri());
    let app = router(AppState::new(config));
    for (index, path) in [
        "/data/datasets/upload/dataset",
        "/data/datasets",
        "/data/v10/datasets",
    ]
    .iter()
    .enumerate()
    {
        let response = app
            .clone()
            .oneshot(
                Request::post(format!("{path}?token=secret"))
                    .header("content-type", "multipart/form-data; boundary=test")
                    .body(Body::from("--test--\r\n"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        wait_for_calls(&webhook, index + 1).await;
        assert_eq!(
            webhook.calls()[index].json()["attachments"][0]["text"],
            format!("Answering 400 at {path}")
        );
    }
    let response = app
        .oneshot(
            Request::post("/data/v13/datasets/finishUpload?token=secret")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    wait_for_calls(&webhook, 4).await;
    assert_eq!(
        webhook.calls()[3].json()["attachments"][0]["text"],
        "Answering 400 at /data/v13/datasets/finishUpload"
    );
}
