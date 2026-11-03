//! Mailchimp audience integration: port of Play's `mail.MailchimpClient` and
//! `mail.MailchimpTag` (webknossos.org only).
//!
//! - Register: `PUT {host}/lists/{listId}/members/{hash}` with
//!   `{"email_address","status":"subscribed","merge_fields":{"FNAME","LNAME"}}`, then (only if
//!   that succeeded) the tag.
//! - Tag: `POST {host}/lists/{listId}/members/{hash}/tags` with
//!   `{"tags":[{"name":<snake_case tag>,"status":"active"}]}`.
//! - Tags: `GET {host}/lists/{listId}/members/{hash}/tags` (`{"tags":[{"name",...}]}`).
//!
//! Every request uses HTTP basic auth (`mail.mailchimp.user` / `password`). `{hash}` is the
//! MD5 of the email address (hex, uppercase as Play's `SCrypt.md5`), lowercased first as the
//! Mailchimp API requires. An empty host disables the client: every call is a no-op, as in Play.
//!
//! Route call sites are fire-and-forget: [`MailchimpClient::register_user`] and
//! [`MailchimpClient::tag_user`] spawn the requests and only log failures, so Mailchimp can never
//! fail or slow down a request. The hourly activity tagging lives in
//! [`crate::background::mailchimp_ticker`].
use std::{collections::HashMap, fmt, sync::Arc, time::Duration};

use md5::{Digest, Md5};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::task::JoinHandle;

use crate::{
    background::scheduler::JobSchedule,
    config::{ConfigError, Env},
    util::id::ObjectId,
};

pub(crate) mod mailchimp_dao;

/// Timeout of one Mailchimp request (Play WS default is 2 min; a shorter bound keeps spawned
/// tasks from piling up).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// `MailchimpTicker.tickerInterval` and `tickerInitialDelay`: one hour each.
pub const DEFAULT_TICKER_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// `mail.MailchimpTag`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MailchimpTag {
    RegisteredAsUser,
    RegisteredAsAdmin,
    HasAnnotated,
    HasInvitedTeam,
    HasUploadedOwnDataset,
    HasViewedPublishedDataset,
    WasActiveInWeeksTwoOrThree,
    WasInactiveInWeeksTwoAndThree,
}

impl MailchimpTag {
    pub const ALL: [Self; 8] = [
        Self::RegisteredAsUser,
        Self::RegisteredAsAdmin,
        Self::HasAnnotated,
        Self::HasInvitedTeam,
        Self::HasUploadedOwnDataset,
        Self::HasViewedPublishedDataset,
        Self::WasActiveInWeeksTwoOrThree,
        Self::WasInactiveInWeeksTwoAndThree,
    ];

    /// `MailchimpTag.format`: the enum name in snake case.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RegisteredAsUser => "registered_as_user",
            Self::RegisteredAsAdmin => "registered_as_admin",
            Self::HasAnnotated => "has_annotated",
            Self::HasInvitedTeam => "has_invited_team",
            Self::HasUploadedOwnDataset => "has_uploaded_own_dataset",
            Self::HasViewedPublishedDataset => "has_viewed_published_dataset",
            Self::WasActiveInWeeksTwoOrThree => "was_active_in_weeks_two_or_three",
            Self::WasInactiveInWeeksTwoAndThree => "was_inactive_in_weeks_two_and_three",
        }
    }

    /// `MailchimpTag.fromString`: a formatted name back to the tag; other tags are ignored.
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tag| tag.as_str() == name)
    }
}

impl fmt::Display for MailchimpTag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// `mail.mailchimp.*` plus the ticker schedule (`WK_MAILCHIMP_*`).
#[derive(Clone, PartialEq, Eq)]
pub struct MailchimpConfig {
    /// `mail.mailchimp.host` without trailing slash (e.g. `https://us1.api.mailchimp.com/3.0`);
    /// `None` (empty) disables the client and the ticker.
    pub host: Option<String>,
    pub list_id: String,
    pub user: String,
    /// API key; never printed.
    pub password: String,
    /// `MailchimpTicker` schedule (hourly, first run after one hour).
    pub ticker: JobSchedule,
}

impl Default for MailchimpConfig {
    fn default() -> Self {
        Self {
            host: None,
            list_id: String::new(),
            user: String::new(),
            password: String::new(),
            ticker: JobSchedule {
                enabled: true,
                interval: DEFAULT_TICKER_INTERVAL,
                initial_delay: DEFAULT_TICKER_INTERVAL,
            },
        }
    }
}

impl fmt::Debug for MailchimpConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MailchimpConfig")
            .field("host", &self.host)
            .field("list_id", &self.list_id)
            .field("user", &self.user)
            .field("password_configured", &!self.password.is_empty())
            .field("ticker", &self.ticker)
            .finish()
    }
}

/// Parses settings from environment values (called by config.rs):
/// `WK_MAILCHIMP_HOST` (default empty = disabled; an absolute HTTP(S) URL otherwise),
/// `WK_MAILCHIMP_LIST_ID`, `WK_MAILCHIMP_USER`, `WK_MAILCHIMP_PASSWORD` (default empty) and
/// `WK_MAILCHIMP_TICKER_{ENABLED,INTERVAL_SECONDS,INITIAL_DELAY_SECONDS}` (default true, 3600,
/// 3600; the ticker only runs with a host).
pub fn config_from_values(
    values: &HashMap<String, String>,
) -> Result<MailchimpConfig, ConfigError> {
    let env = Env::new(values);
    let default = MailchimpConfig::default();
    let host = match env.get("WK_MAILCHIMP_HOST").map(str::trim) {
        None | Some("") => None,
        Some(raw) => {
            let valid = url::Url::parse(raw)
                .ok()
                .is_some_and(|url| matches!(url.scheme(), "http" | "https") && url.has_host());
            if !valid {
                return Err(ConfigError(
                    "WK_MAILCHIMP_HOST must be an absolute HTTP(S) URL".into(),
                ));
            }
            Some(raw.trim_end_matches('/').to_owned())
        }
    };
    Ok(MailchimpConfig {
        host,
        list_id: env.text("WK_MAILCHIMP_LIST_ID", "").trim().to_owned(),
        user: env.text("WK_MAILCHIMP_USER", ""),
        password: env.text("WK_MAILCHIMP_PASSWORD", ""),
        ticker: JobSchedule::from_env(env, "WK_MAILCHIMP_TICKER", default.ticker)?,
    })
}

/// Mailchimp's subscriber hash as Play computes it (`SCrypt.md5`, uppercase hex) of the
/// lowercased email address.
pub fn subscriber_hash(email: &str) -> String {
    let digest = Md5::digest(email.to_lowercase().as_bytes());
    digest.iter().map(|byte| format!("{byte:02X}")).collect()
}

/// Name and address of a list member (from `webknossos.multiUsers`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberContact {
    pub email: String,
    pub first_name: String,
    pub last_name: String,
}

/// Body of the member PUT.
pub fn member_body(contact: &MemberContact) -> Value {
    json!({
        "email_address": contact.email,
        "status": "subscribed",
        "merge_fields": {
            "FNAME": contact.first_name,
            "LNAME": contact.last_name,
        },
    })
}

/// Body of the tag POST.
pub fn tag_body(tag: MailchimpTag) -> Value {
    json!({ "tags": [{ "name": tag.as_str(), "status": "active" }] })
}

#[derive(Deserialize)]
struct TagsResponse {
    tags: Vec<TagResponse>,
}

#[derive(Deserialize)]
struct TagResponse {
    name: String,
}

/// A failed Mailchimp request. Never contains the URL or credentials.
#[derive(Debug)]
pub struct MailchimpError(String);

impl fmt::Display for MailchimpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for MailchimpError {}

impl From<reqwest::Error> for MailchimpError {
    fn from(error: reqwest::Error) -> Self {
        Self(error.without_url().to_string())
    }
}

struct Inner {
    host: String,
    list_id: String,
    user: String,
    password: String,
    http: reqwest::Client,
}

/// `mail.MailchimpClient` (cheap to clone). The default is disabled.
#[derive(Clone, Default)]
pub struct MailchimpClient {
    inner: Option<Arc<Inner>>,
}

impl fmt::Debug for MailchimpClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MailchimpClient")
            .field("enabled", &self.is_enabled())
            .finish()
    }
}

impl MailchimpClient {
    pub fn new(config: &MailchimpConfig) -> Self {
        let inner = config.host.as_ref().and_then(|host| {
            match reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build() {
                Ok(http) => Some(Arc::new(Inner {
                    host: host.clone(),
                    list_id: config.list_id.clone(),
                    user: config.user.clone(),
                    password: config.password.clone(),
                    http,
                })),
                Err(error) => {
                    tracing::error!(%error, "Could not build the Mailchimp HTTP client; Mailchimp is disabled");
                    None
                }
            }
        });
        Self { inner }
    }

    /// Whether a host is configured (`conf.host.nonEmpty`).
    pub fn is_enabled(&self) -> bool {
        self.inner.is_some()
    }

    fn member_url(inner: &Inner, email: &str) -> String {
        format!(
            "{}/lists/{}/members/{}",
            inner.host,
            inner.list_id,
            subscriber_hash(email)
        )
    }

    fn request(inner: &Inner, method: reqwest::Method, url: String) -> reqwest::RequestBuilder {
        inner
            .http
            .request(method, url)
            .basic_auth(&inner.user, Some(&inner.password))
    }

    /// The member PUT (`None` when disabled).
    pub fn put_member_request(&self, contact: &MemberContact) -> Option<reqwest::RequestBuilder> {
        let inner = self.inner.as_deref()?;
        Some(
            Self::request(
                inner,
                reqwest::Method::PUT,
                Self::member_url(inner, &contact.email),
            )
            .json(&member_body(contact)),
        )
    }

    /// The tag POST (`None` when disabled).
    pub fn post_tag_request(
        &self,
        email: &str,
        tag: MailchimpTag,
    ) -> Option<reqwest::RequestBuilder> {
        let inner = self.inner.as_deref()?;
        let url = format!("{}/tags", Self::member_url(inner, email));
        Some(Self::request(inner, reqwest::Method::POST, url).json(&tag_body(tag)))
    }

    /// The tags GET (`None` when disabled).
    pub fn get_tags_request(&self, email: &str) -> Option<reqwest::RequestBuilder> {
        let inner = self.inner.as_deref()?;
        let url = format!("{}/tags", Self::member_url(inner, email));
        Some(Self::request(inner, reqwest::Method::GET, url))
    }

    async fn send(
        request: Option<reqwest::RequestBuilder>,
    ) -> Result<Option<reqwest::Response>, MailchimpError> {
        let Some(request) = request else {
            return Ok(None);
        };
        let response = request.send().await?;
        let status = response.status();
        if status.is_success() {
            Ok(Some(response))
        } else {
            Err(MailchimpError(format!("Mailchimp answered {status}")))
        }
    }

    /// PUT the member (no-op when disabled).
    pub async fn put_member(&self, contact: &MemberContact) -> Result<(), MailchimpError> {
        Self::send(self.put_member_request(contact)).await.map(drop)
    }

    /// POST one tag for the member with this address (no-op when disabled).
    pub async fn tag_email(&self, email: &str, tag: MailchimpTag) -> Result<(), MailchimpError> {
        Self::send(self.post_tag_request(email, tag))
            .await
            .map(drop)
    }

    /// `tagsForMultiUser`: the member's known tags (empty when disabled).
    pub async fn tags_for_email(&self, email: &str) -> Result<Vec<MailchimpTag>, MailchimpError> {
        let Some(response) = Self::send(self.get_tags_request(email)).await? else {
            return Ok(Vec::new());
        };
        let body: TagsResponse = response.json().await?;
        Ok(body
            .tags
            .iter()
            .filter_map(|tag| MailchimpTag::parse(&tag.name))
            .collect())
    }

    /// `registerUser(user, multiUser, tag)`: spawns the member PUT and then, if it succeeded,
    /// the tag POST. Returns the spawned task (tests), `None` when disabled.
    pub fn register_user(
        &self,
        user_id: &ObjectId,
        contact: MemberContact,
        tag: MailchimpTag,
    ) -> Option<JoinHandle<()>> {
        if !self.is_enabled() {
            return None;
        }
        tracing::info!(user = %user_id, tag = %tag, "Registering user for Mailchimp");
        let client = self.clone();
        let user_id = user_id.clone();
        spawn(async move {
            let result = match client.put_member(&contact).await {
                Ok(()) => client.tag_email(&contact.email, tag).await,
                Err(error) => Err(error),
            };
            if let Err(error) = result {
                tracing::warn!(user = %user_id, tag = %tag, %error, "Mailchimp registration failed");
            }
        })
    }

    /// `tagUser(user, tag)`: looks up the user's email address and spawns the tag POST.
    /// Returns the spawned task (tests), `None` when disabled.
    pub fn tag_user(
        &self,
        pool: &PgPool,
        user_id: &ObjectId,
        tag: MailchimpTag,
    ) -> Option<JoinHandle<()>> {
        if !self.is_enabled() {
            return None;
        }
        let (client, pool, user_id) = (self.clone(), pool.clone(), user_id.clone());
        spawn(async move {
            let email = match mailchimp_dao::find_email_of_user(&pool, &user_id).await {
                Ok(Some(email)) => email,
                Ok(None) => return,
                Err(error) => {
                    tracing::warn!(user = %user_id, %error, "Mailchimp tag: user lookup failed");
                    return;
                }
            };
            if let Err(error) = client.tag_email(&email, tag).await {
                tracing::warn!(user = %user_id, tag = %tag, %error, "Mailchimp tagging failed");
            }
        })
    }
}

fn spawn(task: impl std::future::Future<Output = ()> + Send + 'static) -> Option<JoinHandle<()>> {
    match tokio::runtime::Handle::try_current() {
        Ok(runtime) => Some(runtime.spawn(task)),
        Err(_) => {
            tracing::warn!("Not calling Mailchimp outside of a Tokio runtime");
            None
        }
    }
}

#[cfg(test)]
mod mailchimp_tests;
