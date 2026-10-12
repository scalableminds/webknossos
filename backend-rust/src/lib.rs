pub mod ai_models;
pub mod analytics;
pub mod annotation_access;
pub mod annotation_create;
pub mod annotation_download;
pub mod annotation_duplicate;
pub mod annotation_finish;
pub mod annotation_info;
pub mod annotation_lifecycle;
pub mod annotation_lists;
pub mod annotation_merge;
pub mod annotation_metadata;
pub mod annotation_mutex;
pub mod annotation_private_links;
pub mod annotation_provider;
pub mod annotation_reopen;
pub mod annotation_reservations;
pub mod annotation_reset;
pub mod annotation_sandbox;
pub mod annotation_transfer;
pub mod annotation_upload;
pub mod annotation_upload_service;
pub mod application_info;
pub mod auth;
pub mod auth_oidc;
pub mod auth_routes;
pub mod auth_webauthn;
pub mod browser_auth;
pub mod browser_auth_account;
pub mod browser_auth_onboarding;
pub mod cbor;
pub mod config;
pub mod credentials;
pub mod credit_ticker;
pub mod credit_transactions;
pub mod data_stores;
pub mod dataset_access;
pub mod dataset_compose;
pub mod dataset_configuration;
pub mod dataset_create;
pub mod dataset_explore;
pub mod dataset_lifecycle;
pub mod dataset_options;
pub mod dataset_paths;
pub mod dataset_remote;
pub mod dataset_sam;
pub mod dataset_source;
pub mod dataset_storage;
pub mod dataset_update;
pub mod dataset_upload_paths;
pub mod datasets;
pub mod db;
pub mod error;
pub mod extract;
pub mod folders;
pub mod housekeeping;
pub mod id;
pub mod initial_data;
mod instant;
pub mod java_format;
pub mod job_submission;
pub mod job_workers;
pub mod jobs;
mod legacy_datasets;
pub mod mail;
pub mod maintenance;
pub mod nml_parser;
pub mod nml_writer;
pub mod organizations;
pub mod pricing;
pub mod projects;
pub mod proto;
pub mod publications;
pub mod remote_datastore;
pub mod remote_datastore_attachment_upload;
pub mod remote_datastore_dataset_report;
pub mod remote_datastore_dataset_upload;
pub mod remote_datastore_lookup;
pub mod remote_datastore_mag_upload;
pub mod remote_tracingstore_create;
pub mod remote_tracingstore_reads;
pub mod remote_tracingstore_report;
pub mod remote_tracingstore_update;
pub mod reports;
pub mod scheduler;
pub mod scripts;
pub mod service_clients;
pub mod short_links;
pub mod slack;
pub mod task_assignment;
pub mod task_creation;
pub mod task_creation_from_files;
pub mod task_request;
pub mod task_types;
pub mod tasks;
pub mod teams;
pub mod terms_of_service;
pub mod thumbnails;
pub mod time_interaction;
pub mod time_interaction_writer;
pub mod time_tracking;
pub mod tracing_initialization;
pub mod tracing_stores;
pub mod tracingstore_client;
pub mod user_access;
pub mod user_configuration;
pub mod users;
pub mod voxelytics;
mod voxelytics_dao;
mod voxelytics_loki;
pub mod worker_liveness;

use axum::{
    Router,
    extract::{DefaultBodyLimit, MatchedPath, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use error::{ApiError, ApiResult};
use std::time::Duration;
use tower_http::{
    catch_panic::CatchPanicLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

/// Construct the API with conservative local defaults, also used by HTTP tests.
pub fn router(state: AppState) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs_enabled: false,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: auth_routes::AuthRouteConfig::default(),
            browser_auth: browser_auth::BrowserAuthConfig::default(),
            mailer: mail::MailSender::default(),
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
    browser_auth: browser_auth::BrowserAuthConfig,
    mailer: mail::MailSender,
) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs_enabled: false,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: auth_routes::AuthRouteConfig::default(),
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
    misc: application_info::MiscConfig,
    mailer: mail::MailSender,
) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs_enabled: misc.jobs_enabled,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: auth_routes::AuthRouteConfig::default(),
            browser_auth: browser_auth::BrowserAuthConfig::default(),
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
    misc: application_info::MiscConfig,
    voxelytics: voxelytics::VoxelyticsConfig,
) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: Duration::from_secs(30),
            body_limit: 2 * 1024 * 1024,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            email_verification_enabled: true,
            jobs_enabled: misc.jobs_enabled,
            jobs: Default::default(),
            annotation_mutex_expiry: Duration::from_secs(120),
            time_tracking: Default::default(),
            allow_delete_datasets: true,
            datasets: Default::default(),
            auth_routes: auth_routes::AuthRouteConfig::default(),
            browser_auth: browser_auth::BrowserAuthConfig::default(),
            mailer: mail::MailSender::default(),
            service_client: Default::default(),
            misc,
            voxelytics,
            oidc: Default::default(),
            slack: Default::default(),
        },
    )
}

pub fn router_with_config(state: AppState, config: &config::Config) -> Router {
    build_router(
        state,
        RouteOptions {
            request_timeout: config.request_timeout,
            body_limit: config.body_limit,
            public_url: config.public_url.clone(),
            email_verification_enabled: config.email_verification_enabled,
            jobs_enabled: config.jobs_enabled,
            jobs: config.jobs.clone(),
            annotation_mutex_expiry: config.annotation_mutex_expiry,
            time_tracking: config.time_tracking,
            auth_routes: config.auth_routes.clone(),
            browser_auth: config.browser_auth.clone(),
            mailer: mail::MailSender::from_config(&config.mail),
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
    jobs_enabled: bool,
    jobs: jobs::JobsConfig,
    annotation_mutex_expiry: Duration,
    time_tracking: config::TimeTrackingConfig,
    auth_routes: auth_routes::AuthRouteConfig,
    browser_auth: browser_auth::BrowserAuthConfig,
    mailer: mail::MailSender,
    allow_delete_datasets: bool,
    datasets: dataset_options::DatasetRouteConfig,
    service_client: service_clients::ServiceClientConfig,
    misc: application_info::MiscConfig,
    voxelytics: voxelytics::VoxelyticsConfig,
    oidc: auth_oidc::OidcConfig,
    slack: slack::SlackConfig,
}

fn build_router(state: AppState, options: RouteOptions) -> Router {
    let RouteOptions {
        request_timeout,
        body_limit,
        public_url,
        email_verification_enabled,
        jobs_enabled,
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
    let tracing_store_client = tracingstore_client::TracingStoreClient::new(service_client.clone())
        .expect("validated service client configuration");
    let annotation_provider = annotation_provider::AnnotationProvider::new(
        state.pool.clone(),
        tracing_store_client.clone(),
    );
    // One writer per app: its per-user cache and locks must be shared by all routes.
    let time_interaction_writer = time_interaction_writer::TimeInteractionWriter::new(
        Default::default(),
        time_tracking.interaction,
        time_interaction_writer::OverLimitNotifier::new(mailer.clone(), public_url.as_str()),
    );
    let clients = service_clients::ServiceClients::new(service_client)
        .expect("validated service client configuration");
    let datastore_tokens = dataset_explore::DatastoreTokenConfig {
        expiry: auth_routes.datastore_expiry,
        idle_timeout: auth_routes.auth_idle_timeout,
    };
    let api = Router::new()
        .route("/health", get(|| async { "Ok" }))
        .merge(annotation_private_links::router())
        .merge(application_info::router())
        .merge(analytics::router())
        .merge(initial_data::router())
        .merge(annotation_lists::router(jobs_enabled))
        .merge(annotation_lifecycle::router())
        .merge(annotation_metadata::router(jobs_enabled))
        .merge(annotation_mutex::router(annotation_mutex_expiry))
        .merge(annotation_reopen::router(jobs_enabled))
        .merge(annotation_finish::router(jobs_enabled))
        .merge(annotation_info::router(jobs_enabled))
        .merge(annotation_duplicate::router(jobs_enabled))
        .merge(annotation_download::router(jobs_enabled))
        .merge(annotation_create::router(jobs_enabled))
        .merge(task_assignment::router(jobs_enabled))
        .merge(task_request::router(jobs_enabled))
        .merge(task_creation::router(jobs_enabled))
        .merge(task_creation_from_files::router(jobs_enabled))
        .merge(annotation_upload::router(jobs_enabled))
        .merge(annotation_merge::router(jobs_enabled))
        .merge(annotation_reset::router(jobs_enabled))
        .merge(annotation_reservations::router(jobs_enabled))
        .merge(annotation_sandbox::router(jobs_enabled))
        .merge(annotation_transfer::router(jobs_enabled))
        .merge(ai_models::router(jobs_enabled))
        .merge(ai_models::upload_router(
            jobs_enabled,
            datasets.upload_to_paths.clone(),
        ))
        .merge(job_submission::router(jobs_enabled))
        .merge(job_workers::router(&jobs, auth_routes.auth_idle_timeout))
        .merge(jobs::router(jobs_enabled, jobs, auth_routes.clone()))
        .merge(voxelytics::router(voxelytics))
        .merge(auth_oidc::router(oidc))
        .merge(auth_webauthn::router())
        .merge(auth_routes::router(auth_routes))
        .merge(browser_auth::router())
        .merge(browser_auth_account::router())
        .merge(browser_auth_onboarding::router())
        .merge(credentials::router())
        .merge(remote_datastore::router())
        .merge(remote_datastore_lookup::router())
        .merge(remote_datastore_mag_upload::router())
        .merge(remote_datastore_dataset_upload::router())
        .merge(remote_datastore_dataset_report::router())
        .merge(remote_datastore_attachment_upload::router())
        .merge(remote_tracingstore_reads::router())
        .merge(remote_tracingstore_update::router())
        .merge(remote_tracingstore_report::router())
        .merge(remote_tracingstore_create::router())
        .merge(data_stores::router(jobs_enabled))
        .merge(datasets::router())
        .merge(datasets::metadata_router(jobs_enabled))
        .merge(datasets::lookup_router(jobs_enabled))
        .merge(dataset_configuration::router())
        .merge(dataset_remote::router())
        .merge(thumbnails::router())
        .merge(dataset_paths::router(datasets.clone()))
        .merge(dataset_compose::router())
        .merge(dataset_sam::router(datasets.clone()))
        .merge(dataset_explore::router(datastore_tokens))
        .merge(dataset_upload_paths::router(datasets.clone()))
        .merge(dataset_update::router(jobs_enabled))
        .merge(dataset_lifecycle::router(
            allow_delete_datasets,
            jobs_enabled,
        ))
        .merge(teams::router())
        .merge(tracing_stores::router())
        .merge(scripts::router())
        .merge(folders::router())
        .merge(user_configuration::router())
        .merge(user_access::router(allow_delete_datasets))
        .merge(users::router(email_verification_enabled))
        .merge(maintenance::router())
        .merge(organizations::router())
        .merge(pricing::router())
        .merge(terms_of_service::router())
        .merge(short_links::router())
        .merge(projects::router())
        .merge(task_types::router())
        .merge(tasks::router())
        .merge(time_tracking::router())
        .merge(reports::router())
        .merge(credit_transactions::router())
        .merge(publications::router(jobs_enabled));
    let mut app = Router::new()
        .route("/health/live", get(|| async { "Ok" }))
        .route("/health/ready", get(readiness))
        .nest(
            "/api",
            api.clone()
                .merge(datasets::list_router())
                .merge(datasets::read_router(jobs_enabled)),
        );
    // Dataset list defaults changed in v16; bigint envelopes changed in v15.
    for version in 10..=16 {
        let dataset_api = if version == 16 {
            datasets::list_router()
        } else {
            legacy_datasets::router(jobs_enabled)
        }
        .merge(datasets::read_router(jobs_enabled));
        let dataset_api = if version <= 14 {
            dataset_api.layer(middleware::from_fn(legacy_datasets::downgrade_response))
        } else {
            dataset_api
        };
        app = app.nest(&format!("/api/v{version}"), api.clone().merge(dataset_api));
    }
    app.fallback(|| async { ApiError::not_found("Route not implemented by the Rust backend.") })
        .method_not_allowed_fallback(|| async {
            ApiError::new(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed.")
        })
        .layer(DefaultBodyLimit::max(body_limit))
        .layer(axum::Extension(clients))
        .layer(axum::Extension(tracing_store_client))
        .layer(axum::Extension(annotation_provider))
        .layer(middleware::from_fn(browser_auth::cookie_middleware))
        .layer(axum::Extension(browser_auth))
        .layer(axum::Extension(mailer))
        .layer(axum::Extension(time_interaction_writer))
        .layer(axum::Extension(time_tracking))
        .layer(axum::Extension(slack::SlackNotificationService::new(
            &slack,
        )))
        .layer(axum::Extension(application_info::MiscState::new(misc)))
        .layer(axum::Extension(short_links::PublicUrl(public_url)))
        .layer(middleware::from_fn_with_state(request_timeout, timeout))
        .layer(CatchPanicLayer::custom(|_| {
            ApiError::internal().into_response()
        }))
        .layer(middleware::from_fn(response_headers))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request| {
                // Never log raw URI/query strings: legacy clients put auth tokens in them.
                let route = request
                    .extensions()
                    .get::<MatchedPath>()
                    .map(MatchedPath::as_str)
                    .unwrap_or("unmatched");
                tracing::info_span!("http_request", method = %request.method(), route)
            }),
        )
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .with_state(state)
}

async fn readiness(State(state): State<AppState>) -> ApiResult<&'static str> {
    db::ready(&state.pool).await?;
    Ok("Ok")
}

async fn timeout(State(duration): State<Duration>, request: Request, next: Next) -> Response {
    let duration = if uses_long_rpc(request.method(), request.uri().path()) {
        duration.max(tracingstore_client::LONG_REQUEST_TIMEOUT)
    } else {
        duration
    };
    match tokio::time::timeout(duration, next.run(request)).await {
        Ok(response) => response,
        Err(_) => ApiError::new(StatusCode::GATEWAY_TIMEOUT, "Request timed out.").into_response(),
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
mod long_rpc_tests {
    use super::uses_long_rpc;
    use axum::http::Method;

    #[test]
    fn long_rpc_routes_are_exempt() {
        assert!(uses_long_rpc(
            &Method::PUT,
            "/api/annotations/Task/abc/reset"
        ));
        assert!(uses_long_rpc(
            &Method::PUT,
            "/api/v12/annotations/Task/abc/reset"
        ));
        assert!(uses_long_rpc(
            &Method::POST,
            "/api/annotations/a/merge/Task/b"
        ));
        assert!(uses_long_rpc(
            &Method::POST,
            "/api/annotations/Explorational/a/merge/Task/b"
        ));
        assert!(uses_long_rpc(
            &Method::POST,
            "/api/annotations/Explorational/a/duplicate"
        ));
        assert!(uses_long_rpc(
            &Method::POST,
            "/api/datasets/d/createExplorational"
        ));
        assert!(!uses_long_rpc(
            &Method::GET,
            "/api/annotations/Task/abc/reset"
        ));
        assert!(!uses_long_rpc(
            &Method::PATCH,
            "/api/annotations/Task/abc/finish"
        ));
        assert!(!uses_long_rpc(
            &Method::POST,
            "/api/vx/annotations/a/merge/Task/b"
        ));
    }
}
