//! AboutPageRedirectController.redirectToAboutPageOrSendMainView: every non-API, non-asset path
//! (RequestHandler's catch-all) answers the built frontend's `index.html` with per-request
//! replacements (commit hash, the user's theme, OpenGraph tags, wkorg metadata, Airbrake
//! config), or redirects to the about page on wkorg instances.
//!
//! Static frontend files (`/assets`, `/images`, `/wasm`) come from the same public directory
//! (`static_files.rs`); the wkorg sitemap is not served yet.
use std::{path::PathBuf, sync::Arc};

use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode, Uri, header},
    response::{IntoResponse, Response},
};
use tokio::sync::OnceCell;
use webknossos_common::text::escape_html;

mod main_view_dao;
pub mod open_graph;
mod static_files;

use crate::{
    AppState,
    config::{ConfigError, Env},
    error::{ApiError, ApiResult},
};
use open_graph::OpenGraphTags;

const DEFAULT_PUBLIC_DIR: &str = "public";

/// Play's `play.filters.csp.directives` (application.conf), joined like CspHeaders does.
pub(crate) const CONTENT_SECURITY_POLICY: &str = "default-src * data: mediastream: blob: filesystem: about: \
    ws: wss: 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'; \
    script-src * data: blob: 'unsafe-inline' 'unsafe-eval'; \
    style-src 'self' 'unsafe-inline' *; \
    connect-src * data: blob: 'unsafe-inline'; \
    frame-src * data: blob: ; \
    img-src * data: blob: 'unsafe-inline'; \
    media-src * data: blob: 'unsafe-inline'; \
    font-src * data: blob: 'unsafe-inline'";

const WKORG_METADATA: &str = r#"<meta
      name="description"
      content="Annotate and explore large 3D datasets with WEBKNOSSOS. Fast neurite skeletonization. 3D voxel painting. Collaboration, sharing and crowdsourcing."
    />
    <meta
      name="keywords"
      content="connectomics, data annotation, image segmentation, electron microscopy, light microscopy, fluorescence microscopy, skeletonization, webknossos"
    />"#;

/// `aboutPageRedirect.*`, `airbrake.*` and the location of the built frontend.
#[derive(Clone, Debug)]
pub struct MainViewConfig {
    /// Directory holding the built frontend's `index.html` (`WK_PUBLIC_DIR`, Play's `public/`).
    pub public_dir: PathBuf,
    /// `aboutPageRedirect.prefix` (`WK_ABOUT_PAGE_REDIRECT_PREFIX`).
    pub about_page_redirect_prefix: String,
    /// `aboutPageRedirect.routes` (`WK_ABOUT_PAGE_REDIRECT_ROUTES`, comma-separated; `*` is a wildcard).
    pub about_page_redirect_routes: Vec<String>,
    pub airbrake: AirbrakeConfig,
}

/// `airbrake.*`, rendered into the main view for the frontend error reporter.
#[derive(Clone, Debug)]
pub struct AirbrakeConfig {
    pub project_id: String,
    pub project_key: String,
    pub environment: String,
}

impl Default for MainViewConfig {
    fn default() -> Self {
        Self {
            public_dir: DEFAULT_PUBLIC_DIR.into(),
            about_page_redirect_prefix: String::new(),
            about_page_redirect_routes: Vec::new(),
            airbrake: AirbrakeConfig {
                project_id: "insert-valid-projectID-here".into(),
                project_key: "insert-valid-projectKey-here".into(),
                environment: "dev-local".into(),
            },
        }
    }
}

pub(crate) fn config_from_values(
    values: &std::collections::HashMap<String, String>,
) -> Result<MainViewConfig, ConfigError> {
    let env = Env::new(values);
    let defaults = MainViewConfig::default();
    Ok(MainViewConfig {
        public_dir: env.text("WK_PUBLIC_DIR", DEFAULT_PUBLIC_DIR).into(),
        about_page_redirect_prefix: env.text("WK_ABOUT_PAGE_REDIRECT_PREFIX", ""),
        about_page_redirect_routes: env
            .text("WK_ABOUT_PAGE_REDIRECT_ROUTES", "")
            .split(',')
            .map(str::trim)
            .filter(|route| !route.is_empty())
            .map(str::to_owned)
            .collect(),
        airbrake: AirbrakeConfig {
            project_id: env.text("WK_AIRBRAKE_PROJECT_ID", &defaults.airbrake.project_id),
            project_key: env.text("WK_AIRBRAKE_PROJECT_KEY", &defaults.airbrake.project_key),
            environment: env.text("WK_AIRBRAKE_ENVIRONMENT", &defaults.airbrake.environment),
        },
    })
}

/// The configuration plus the template, read once on first use like Play's `lazy val`
/// (a failed read is retried on the next request instead of being cached).
#[derive(Clone)]
pub struct MainView(Arc<MainViewInner>);

struct MainViewInner {
    config: MainViewConfig,
    template: OnceCell<String>,
}

impl MainView {
    pub fn new(config: MainViewConfig) -> Self {
        Self(Arc::new(MainViewInner {
            config,
            template: OnceCell::new(),
        }))
    }

    pub fn config(&self) -> &MainViewConfig {
        &self.0.config
    }

    async fn template(&self) -> Option<&str> {
        let path = self.0.config.public_dir.join("index.html");
        self.0
            .template
            .get_or_try_init(|| tokio::fs::read_to_string(path))
            .await
            .ok()
            .map(String::as_str)
    }
}

/// RequestHandler's routing for paths no API route matched: `None` keeps the JSON 404.
pub(crate) async fn handle(state: &AppState, request: Request) -> Option<Response> {
    let uri = request.uri().clone();
    let path = uri.path();
    let is_wkorg_instance = state.misc.config().is_wkorg_instance;
    if static_files::is_static_path(path) {
        return static_files::serve(&state.main_view, request).await;
    }
    if ["/api/", "/data/", "/tracings/", "/.well-known/"]
        .iter()
        .any(|prefix| path.starts_with(prefix))
        || path == "/favicon.ico"
        || (is_wkorg_instance && path == "/sitemap.xml")
    {
        return None;
    }
    if is_wkorg_instance && is_service_worker_path(path) {
        return Some(([(header::CONTENT_TYPE, "text/javascript")], "").into_response());
    }
    Some(match main_view(state, request).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    })
}

/// Play's `^/sw\.(.*)\.js$`.
fn is_service_worker_path(path: &str) -> bool {
    path.strip_prefix("/sw.")
        .and_then(|rest| rest.strip_suffix(".js"))
        .is_some()
}

async fn main_view(state: &AppState, request: Request) -> ApiResult<Response> {
    let (parts, _) = request.into_parts();
    // UserAwareAction: Play ignores invalid credentials and answers anonymously. Shared
    // annotation links carry their private-link token as `?token=`, which is not a user token.
    let user = crate::auth::authenticate_request(&parts, state)
        .await
        .ok()
        .flatten()
        .map(|(user, _)| user);
    let path_and_query = request_uri(&parts.uri);
    let config = state.main_view.config();
    if state.misc.config().is_wkorg_instance
        && matches_redirect_route(&config.about_page_redirect_routes, parts.uri.path())
        && (user.is_none() || path_and_query != "/")
    {
        let status = if path_and_query == "/" {
            StatusCode::SEE_OTHER
        } else {
            StatusCode::MOVED_PERMANENTLY
        };
        let location = format!("{}{path_and_query}", config.about_page_redirect_prefix);
        let location = HeaderValue::from_str(&location).map_err(|_| ApiError::internal())?;
        return Ok((status, [(header::LOCATION, location)]).into_response());
    }

    let theme = match &user {
        Some(user) => main_view_dao::find_selected_theme(&state.pool, &user.id).await?,
        None => None,
    };
    let query = query_pairs(&parts.uri);
    let sharing_token =
        first_value(&query, "sharingToken").or_else(|| first_value(&query, "token"));
    let tags = open_graph::tags(state, user.as_ref(), parts.uri.path(), sharing_token).await;
    let template = state
        .main_view
        .template()
        .await
        .ok_or_else(|| ApiError::bad_request("Could not load main view template"))?;
    let rendered = render(
        template,
        &RenderInput {
            commit_hash: &state.misc.config().build_info.commit_hash,
            theme: theme.as_deref(),
            tags: &tags,
            is_wkorg_instance: state.misc.config().is_wkorg_instance,
            airbrake: &config.airbrake,
        },
    )
    .ok_or_else(|| ApiError::bad_request("Could not render main view template"))?;
    // The main view references the content-hashed asset URLs of the current build, which are
    // deleted as soon as a new version is deployed. "no-store" keeps browsers from replaying a
    // stored copy (history navigation, tab restore) that requests assets that no longer exist.
    Ok((
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY),
        ],
        rendered,
    )
        .into_response())
}

/// Play's `request.uri`: path plus the raw query string.
fn request_uri(uri: &Uri) -> String {
    match uri.query() {
        Some(query) => format!("{}?{query}", uri.path()),
        None => uri.path().to_owned(),
    }
}

fn query_pairs(uri: &Uri) -> Vec<(String, String)> {
    uri.query()
        .map(|query| {
            url::form_urlencoded::parse(query.as_bytes())
                .into_owned()
                .collect()
        })
        .unwrap_or_default()
}

fn first_value(pairs: &[(String, String)], key: &str) -> Option<String> {
    pairs
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.clone())
}

/// `aboutPageRedirect.routes`: the whole path must match; `*` matches any characters.
fn matches_redirect_route(routes: &[String], path: &str) -> bool {
    routes.iter().any(|route| matches_wildcard(route, path))
}

fn matches_wildcard(pattern: &str, text: &str) -> bool {
    let mut parts = pattern.split('*');
    let first = parts.next().unwrap_or_default();
    let Some(mut rest) = text.strip_prefix(first) else {
        return false;
    };
    let parts: Vec<&str> = parts.collect();
    let Some((last, middle)) = parts.split_last() else {
        return rest.is_empty();
    };
    for part in middle {
        match rest.find(part) {
            Some(index) => rest = &rest[index + part.len()..],
            None => return false,
        }
    }
    rest.len() >= last.len() && rest.ends_with(last)
}

struct RenderInput<'a> {
    commit_hash: &'a str,
    /// `multiUsers.selectedTheme`; `None` for anonymous requests (Theme.auto).
    theme: Option<&'a str>,
    tags: &'a OpenGraphTags,
    is_wkorg_instance: bool,
    airbrake: &'a AirbrakeConfig,
}

/// TextUtils.renderTemplateReplacements: every placeholder must be present, applied in order.
fn render(template: &str, input: &RenderInput<'_>) -> Option<String> {
    let theme = input.theme.unwrap_or("auto");
    let theme_css = match theme {
        "dark" => "<style>html { background: black }</style>",
        "light" => "",
        _ => "<style>@media (prefers-color-scheme: dark) { html { background: black } }</style>",
    };
    let airbrake = format!(
        "<script\n      data-airbrake-project-id=\"{}\"\n      data-airbrake-project-key=\"{}\"\n      \
         data-airbrake-environment-name=\"{}\"\n    ></script>",
        input.airbrake.project_id, input.airbrake.project_key, input.airbrake.environment
    );
    let replacements = [
        (
            r#"<meta name="commit-hash" content="" />"#.to_owned(),
            format!(
                r#"<meta name="commit-hash" content="{}" />"#,
                input.commit_hash
            ),
        ),
        (
            r#"<meta name="selected-theme" content="" />"#.to_owned(),
            format!(r#"<meta name="selected-theme" content="{theme}" />"#),
        ),
        ("<!-- INJECT_THEME_CSS -->".to_owned(), theme_css.to_owned()),
        (
            "<!-- INJECT_OPENGRAPH_METADATA -->".to_owned(),
            render_open_graph(input.tags),
        ),
        (
            "<!-- INJECT_WKORG_METADATA -->".to_owned(),
            if input.is_wkorg_instance {
                WKORG_METADATA.to_owned()
            } else {
                String::new()
            },
        ),
        ("<!-- INJECT_AIRBRAKE_CONFIG -->".to_owned(), airbrake),
        (
            "<title>Loading | WEBKNOSSOS</title>".to_owned(),
            "<title>WEBKNOSSOS</title>".to_owned(),
        ),
    ];
    let mut rendered = template.to_owned();
    for (source, replacement) in replacements {
        if !rendered.contains(&source) {
            tracing::warn!(
                placeholder = source,
                "main view template lacks a placeholder"
            );
            return None;
        }
        rendered = rendered.replace(&source, &replacement);
    }
    Some(rendered)
}

fn render_open_graph(tags: &OpenGraphTags) -> String {
    [
        ("og:title", &tags.title),
        ("og:description", &tags.description),
        ("og:image", &tags.image),
    ]
    .into_iter()
    .filter_map(|(property, value)| {
        value.as_deref().map(|value| {
            format!(
                r#"<meta property="{property}" content="{}" />"#,
                escape_html(value)
            )
        })
    })
    .collect::<Vec<_>>()
    .join("\n    ")
}

#[cfg(test)]
mod main_view_tests;
