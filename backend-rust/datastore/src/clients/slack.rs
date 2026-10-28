//! Datastore Slack attachments and the Scala 30-message/minute limit.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use reqwest::Client;
use serde_json::json;

use crate::config::{DatastoreConfig, Secret};

#[derive(Clone)]
pub struct SlackNotifications {
    inner: Arc<Inner>,
}
struct Inner {
    uri: Secret,
    name: String,
    verbose: bool,
    client: Client,
    rate: Mutex<Rate>,
}
struct Rate {
    reset: Option<Instant>,
    sent: usize,
}
impl Rate {
    fn reserve(&mut self, now: Instant) -> bool {
        if self
            .reset
            .is_none_or(|reset| now.duration_since(reset) > Duration::from_secs(60))
        {
            self.reset = Some(now);
            self.sent = 0;
        }
        if self.sent >= 30 {
            return false;
        }
        self.sent += 1;
        true
    }
}
impl SlackNotifications {
    pub fn new(config: &DatastoreConfig) -> Self {
        Self {
            inner: Arc::new(Inner {
                uri: config.slack_notifications.uri.clone(),
                name: format!("WEBKNOSSOS datastore at {}", redact_uri(&config.http.uri)),
                verbose: config.slack_notifications.verbose_logging_enabled,
                client: Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .timeout(Duration::from_secs(30))
                    .build()
                    .expect("cannot build Slack HTTP client"),
                rate: Mutex::new(Rate {
                    reset: None,
                    sent: 0,
                }),
            }),
        }
    }
    fn send(&self, title: &'static str, message: String, color: &'static str) {
        if self.inner.uri.expose().is_empty() {
            if self.inner.verbose {
                tracing::info!(title, "Slack notification disabled");
            }
            return;
        }
        if !self
            .inner
            .rate
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reserve(Instant::now())
        {
            tracing::warn!(title, "Slack notification rate limit reached");
            return;
        }
        let inner = Arc::clone(&self.inner);
        tokio::spawn(async move {
            let payload = json!({"attachments":[{
                "title":format!("{title} reported from {}", inner.name),
                "text":message, "color":color,
            }]});
            if inner.verbose {
                tracing::info!(title, "Sending Slack notification");
            }
            match inner
                .client
                .post(inner.uri.expose())
                .json(&payload)
                .send()
                .await
            {
                Ok(response) if response.status().is_success() => {}
                Ok(response) => {
                    tracing::warn!(status=%response.status(), "Slack notification failed")
                }
                // reqwest errors contain the secret webhook URL; never print them.
                Err(_) => tracing::warn!("Slack notification transport failed"),
            }
        });
    }
    pub fn internal_error(&self) {
        self.send(
            "Internal Error",
            "Internal dataset data-loading error; inspect datastore logs.".into(),
            "#333ccc",
        );
    }
    pub fn slow_request(&self, method: &str, uri: &str, elapsed: Duration, status: u16) {
        self.send(
            "Slow request",
            format!(
                "Request `{method}` `{}` took {} ms and was {}successful",
                redact_uri(uri),
                elapsed.as_millis(),
                if status == 200 { "" } else { "not " }
            ),
            "#333ccc",
        );
    }
    pub fn failed_upload(&self, uri: &str, status: u16) {
        // Error bodies may contain user credentials or storage URLs, so omit them.
        self.send(
            "Failed dataset upload request",
            format!("Answering {status} at {}", redact_uri(uri)),
            "#ff8a00",
        );
    }
}

/// Retain the route while dropping query values and URL credentials from alert text.
pub fn redact_uri(uri: &str) -> String {
    let path = uri.split(['?', '#']).next().unwrap_or("");
    if let Ok(mut url) = url::Url::parse(path) {
        let _ = url.set_username("");
        let _ = url.set_password(None);
        url.to_string()
    } else {
        path.to_owned()
    }
}

#[cfg(test)]
mod clients_slack_tests;
