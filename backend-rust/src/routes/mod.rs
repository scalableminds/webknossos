use crate::{
    AppState,
    error::{ApiError, ApiResult},
};
use axum::{
    Router,
    extract::{DefaultBodyLimit, MatchedPath, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use std::time::Duration;
use tower_http::{
    catch_panic::CatchPanicLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

/// Construct the API with conservative local defaults, also used by HTTP tests.
pub fn router(state: AppState) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: crate::auth::routes::AuthRouteConfig::default(),
            browser_auth: crate::auth::browser::BrowserAuthConfig::default(),
            mailer: crate::mail::MailSender::default(),
            service_client: Default::default(),
            misc: Default::default(),
            voxelytics: Default::default(),
            oidc: Default::default(),
            slack: Default::default(),
        },
    )
}

/// Local defaults plus explicit browser-session configuration and mailer
/// (used by browser authentication tests).
pub fn router_with_browser_auth(
    state: AppState,
    browser_auth: crate::auth::browser::BrowserAuthConfig,
    mailer: crate::mail::MailSender,
) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: crate::auth::routes::AuthRouteConfig::default(),
            browser_auth,
            mailer,
            service_client: Default::default(),
            misc: Default::default(),
            voxelytics: Default::default(),
            oidc: Default::default(),
            slack: Default::default(),
        },
    )
}

/// Local defaults plus explicit misc-controller configuration and mailer
/// (used by the misc controller tests).
pub fn router_with_misc(
    state: AppState,
    misc: crate::system::application_info::MiscConfig,
    mailer: crate::mail::MailSender,
) -> Router {
    build_router(
        state.with_jobs_enabled(misc.jobs_enabled),
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: crate::auth::routes::AuthRouteConfig::default(),
            browser_auth: crate::auth::browser::BrowserAuthConfig::default(),
            mailer,
            service_client: Default::default(),
            misc,
            voxelytics: Default::default(),
            oidc: Default::default(),
            slack: Default::default(),
        },
    )
}

/// Local defaults plus explicit misc configuration (feature flags) and
/// voxelytics settings (used by the voxelytics tests).
pub fn router_with_voxelytics(
    state: AppState,
    misc: crate::system::application_info::MiscConfig,
    voxelytics: crate::voxelytics::VoxelyticsConfig,
) -> Router {
    build_router(
        state.with_jobs_enabled(misc.jobs_enabled),
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: crate::auth::routes::AuthRouteConfig::default(),
            browser_auth: crate::auth::browser::BrowserAuthConfig::default(),
            mailer: crate::mail::MailSender::default(),
            service_client: Default::default(),
            misc,
            voxelytics,
            oidc: Default::default(),
            slack: Default::default(),
        },
    )
}

pub fn router_with_config(state: AppState, config: &crate::config::Config) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: config.request_timeout,
            body_limit: config.body_limit,
            public_url: config.public_url.clone(),
            email_verification_enabled: config.email_verification_enabled,
            jobs: config.jobs.clone(),
            annotation_mutex_expiry: config.annotation_mutex_expiry,
            time_tracking: config.time_tracking,
            auth_routes: config.auth_routes.clone(),
            browser_auth: config.browser_auth.clone(),
            mailer: crate::mail::MailSender::from_config(&config.mail),
            allow_delete_datasets: config.allow_delete_datasets,
            datasets: config.datasets.clone(),
            service_client: config.service_client.clone(),
            misc: config.misc.clone(),
            voxelytics: config.voxelytics.clone(),
            oidc: config.oidc.clone(),
            slack: config.slack.clone(),
        },
    )
}

struct RouteOptions {
    request_timeout: Duration,
    body_limit: usize,
    public_url: url::Url,
    email_verification_enabled: bool,
    jobs: crate::job::routes::JobsConfig,
    annotation_mutex_expiry: Duration,
    time_tracking: crate::config::TimeTrackingConfig,
    auth_routes: crate::auth::routes::AuthRouteConfig,
    browser_auth: crate::auth::browser::BrowserAuthConfig,
    mailer: crate::mail::MailSender,
    allow_delete_datasets: bool,
    datasets: crate::dataset::options::DatasetRouteConfig,
    service_client: crate::stores::client::ServiceClientConfig,
    misc: crate::system::application_info::MiscConfig,
    voxelytics: crate::voxelytics::VoxelyticsConfig,
    oidc: crate::auth::oidc::OidcConfig,
    slack: crate::slack::SlackConfig,
}

fn build_router(state: AppState, options: RouteOptions) -> Router {
    let RouteOptions {
        request_timeout,
        body_limit,
        public_url,
        email_verification_enabled,
        jobs,
        annotation_mutex_expiry,
        time_tracking,
        auth_routes,
        browser_auth,
        mailer,
        allow_delete_datasets,
        datasets,
        service_client,
        misc,
        voxelytics,
        oidc,
        slack,
    } = options;
    let tracing_store_client =
        crate::stores::tracing_client::TracingStoreClient::new(service_client.clone())
            .expect("validated service client configuration");
    let annotation_provider = crate::annotation::provider::AnnotationProvider::new(
        state.pool.clone(),
        tracing_store_client.clone(),
    );
    // One writer per app: its per-user cache and locks must be shared by all routes.
    let time_interaction_writer = crate::time::interaction_writer::TimeInteractionWriter::new(
        Default::default(),
        time_tracking.interaction,
        crate::time::interaction_writer::OverLimitNotifier::new(
            mailer.clone(),
            public_url.as_str(),
        ),
    );
    let notification_emails = crate::users::notification_emails::NotificationEmailService::new(
        mailer.clone(),
        &browser_auth.public_uri,
    );
    let clients = crate::stores::client::ServiceClients::new(service_client)
        .expect("validated service client configuration");
    let datastore_tokens = crate::dataset::explore::DatastoreTokenConfig {
        expiry: auth_routes.datastore_expiry,
        idle_timeout: auth_routes.auth_idle_timeout,
    };
    let api = Router::new()
        .route("/health", get(|| async { "Ok" }))
        .merge(crate::annotation::router(annotation_mutex_expiry))
        .merge(crate::task::router())
        .merge(crate::job::router(
            state.jobs_enabled.0,
            &jobs,
            &auth_routes,
        ))
        .merge(crate::ai_models::router())
        .merge(crate::ai_models::upload_router(
            datasets.upload_to_paths.clone(),
        ))
        .merge(crate::voxelytics::router(voxelytics))
        .merge(crate::auth::router(oidc, auth_routes.clone()))
        .merge(crate::remote::router(allow_delete_datasets))
        .merge(crate::stores::router())
        .merge(crate::dataset::router(
            &datasets,
            allow_delete_datasets,
            datastore_tokens,
        ))
        .merge(crate::organization::router())
        .merge(crate::system::router())
        .merge(crate::teams::router())
        .merge(crate::scripts::router())
        .merge(crate::folders::router())
        .merge(crate::user_configuration::router())
        .merge(crate::users::router(email_verification_enabled))
        .merge(crate::short_links::router())
        .merge(crate::projects::router())
        .merge(crate::time::tracking::router())
        .merge(crate::reports::router())
        .merge(crate::publications::router());
    let mut app = Router::new()
        .route("/health/live", get(|| async { "Ok" }))
        .route("/health/ready", get(readiness))
        .nest(
            "/api",
            api.clone()
                .merge(crate::dataset::routes::list_router())
                .merge(crate::dataset::routes::read_router()),
        );
    // Dataset list defaults changed in v16; bigint envelopes changed in v15.
    for version in 10..=16 {
        let dataset_api = if version == 16 {
            crate::dataset::routes::list_router()
        } else {
            crate::dataset::legacy::router()
        }
        .merge(crate::dataset::routes::read_router());
        let dataset_api = if version <= 14 {
            dataset_api.layer(middleware::from_fn(
                crate::dataset::legacy::downgrade_response,
            ))
        } else {
            dataset_api
        };
        app = app.nest(&format!("/api/v{version}"), api.clone().merge(dataset_api));
    }
    app.fallback(fallback)
        .method_not_allowed_fallback(|| async {
            ApiError::new(StatusCode::METHOD_NOT_ALLOWED, crate::msg::request::METHOD_NOT_ALLOWED)
        })
        .layer(DefaultBodyLimit::max(body_limit))
        .layer(axum::Extension(clients))
        .layer(axum::Extension(tracing_store_client))
        .layer(axum::Extension(annotation_provider))
        .layer(middleware::from_fn(crate::auth::browser::cookie_middleware))
        .layer(axum::Extension(browser_auth))
        .layer(axum::Extension(mailer))
        .layer(axum::Extension(notification_emails))
        .layer(axum::Extension(time_interaction_writer))
        .layer(axum::Extension(time_tracking))
        .layer(axum::Extension(
            crate::slack::SlackNotificationService::new(&slack),
        ))
        .layer(axum::Extension(
            crate::system::application_info::MiscState::new(misc),
        ))
        .layer(axum::Extension(crate::short_links::PublicUrl(public_url)))
        .layer(middleware::from_fn_with_state(request_timeout, timeout))
        .layer(CatchPanicLayer::custom(|_| {
            ApiError::internal().into_response()
        }))
        // Outside the panic catcher so a panic is counted as the 500 it becomes.
        .layer(middleware::from_fn(crate::system::metrics::record))
        .layer(middleware::from_fn(response_headers))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request| {
                    // Never log raw URI/query strings: legacy clients put auth tokens in them.
                    let route = request
                        .extensions()
                        .get::<MatchedPath>()
                        .map(MatchedPath::as_str)
                        .unwrap_or("unmatched");
                    let request_id = request
                        .headers()
                        .get("x-request-id")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("");
                    tracing::info_span!("http_request", method = %request.method(), route, request_id)
                })
                // Access log: one INFO line per response with status and latency
                // (`RUST_LOG=tower_http=info`, the default); 5xx additionally logs at ERROR.
                .on_response(
                    tower_http::trace::DefaultOnResponse::new()
                        .level(tracing::Level::INFO)
                        .latency_unit(tower_http::LatencyUnit::Millis),
                ),
        )
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .with_state(state)
}

async fn readiness(State(state): State<AppState>) -> ApiResult<&'static str> {
    crate::db::ready(&state.pool).await?;
    Ok("Ok")
}

async fn timeout(State(duration): State<Duration>, request: Request, next: Next) -> Response {
    let duration = if uses_long_rpc(request.method(), request.uri().path()) {
        duration.max(crate::stores::tracing_client::LONG_REQUEST_TIMEOUT)
    } else {
        duration
    };
    match tokio::time::timeout(duration, next.run(request)).await {
        Ok(response) => response,
        Err(_) => ApiError::new(StatusCode::GATEWAY_TIMEOUT, crate::msg::request::TIMED_OUT)
            .into_response(),
    }
}

/// Routes whose upstream RPCs Scala sends `withLongTimeout` (2 h) must not be
/// cut off by the router-wide request timeout.
fn uses_long_rpc(method: &axum::http::Method, path: &str) -> bool {
    use axum::http::Method;
    let mut segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.first() == Some(&"api") {
        segments.remove(0);
        if segments.first().is_some_and(|s| {
            s.len() > 1 && s.starts_with('v') && s[1..].bytes().all(|b| b.is_ascii_digit())
        }) {
            segments.remove(0);
        }
    }
    matches!(
        (method, segments.as_slice()),
        (&Method::PUT, ["annotations", _, _, "reset"])
            | (&Method::POST, ["annotations", _, _, "duplicate"])
            | (&Method::POST, ["annotations", _, "merge", _, _])
            | (&Method::POST, ["annotations", _, _, "merge", _, _])
            | (&Method::POST, ["datasets", _, "createExplorational"])
            | (&Method::POST, ["tasks"])
            | (&Method::POST, ["tasks", "createFromFiles"])
            | (&Method::POST, ["annotations", "upload"])
            | (&Method::POST, ["tasks", _, "assign"])
            | (&Method::GET, ["annotations", _, "download"])
            | (&Method::GET, ["annotations", _, _, "download"])
            | (&Method::POST, ["user", "tasks", "request"])
    )
}

async fn response_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    // Handlers that deliberately allow caching (e.g. thumbnails) set their own header.
    response
        .headers_mut()
        .entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

#[cfg(test)]
mod tests;

/// Unknown routes. Requests for an unsupported API version get Play's
/// `ApiVersioning.invalidApiVersionMessage` (RequestHandler checks the version before routing).
async fn fallback(uri: axum::http::Uri) -> ApiError {
    const OLDEST: u64 = 10;
    const CURRENT: u64 = 16;
    let version = ["/api/v", "/data/v", "/tracings/v"]
        .iter()
        .find_map(|prefix| {
            let digits: String = uri
                .path()
                .strip_prefix(prefix)?
                .chars()
                .take_while(char::is_ascii_digit)
                .collect();
            (!digits.is_empty()).then(|| digits.parse::<u64>().unwrap_or(u64::MAX))
        });
    match version {
        Some(version) if !(OLDEST..=CURRENT).contains(&version) => ApiError::not_found(format!(
            "This WEBKNOSSOS instance does not support the requested HTTP API version. Client requested {version} but must be at least {OLDEST} and at most {CURRENT}."
        )),
        _ => ApiError::not_found(crate::msg::request::ROUTE_NOT_IMPLEMENTED),
    }
}
