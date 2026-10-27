use crate::{
    annotation::provider::AnnotationProvider,
    auth::{browser::BrowserAuthConfig, routes::AuthRouteConfig},
    job::routes::JobsConfig,
    mail::MailSender,
    stores::{
        client::{ServiceClientConfig, ServiceClients},
        tracing_client::TracingStoreClient,
    },
    system::application_info::{MiscConfig, MiscState},
    voxelytics::{VoxelyticsConfig, routes::Voxelytics},
};
use axum::extract::FromRef;

/// Shared services and startup configuration. Handlers extract the part they need with
/// `State<T>`; `FromRef` makes a field that is not in the state a compile error.
#[derive(Clone, FromRef)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub jobs_enabled: JobsEnabled,
    pub misc: MiscState,
    pub clients: ServiceClients,
    pub tracing_store: TracingStoreClient,
    pub annotation_provider: AnnotationProvider,
    pub browser_auth: BrowserAuthConfig,
    pub mailer: MailSender,
    pub auth_routes: AuthRouteConfig,
    pub jobs: JobsConfig,
    pub voxelytics: Voxelytics,
}

/// `features.jobsEnabled`.
#[derive(Clone, Copy, Debug, Default)]
pub struct JobsEnabled(pub bool);

/// Startup configuration of an [`AppState`]; `build` creates the services from it.
pub struct AppStateBuilder {
    pool: sqlx::PgPool,
    jobs_enabled: bool,
    misc: MiscConfig,
    service_client: ServiceClientConfig,
    clients: Option<ServiceClients>,
    tracing_store: Option<TracingStoreClient>,
    annotation_provider: Option<AnnotationProvider>,
    browser_auth: BrowserAuthConfig,
    mailer: MailSender,
    auth_routes: AuthRouteConfig,
    jobs: JobsConfig,
    voxelytics: VoxelyticsConfig,
}

impl AppState {
    /// Local defaults (matching `router`'s), as used by tests.
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self::builder(pool).build()
    }

    /// Local defaults, to be overridden by the builder's setters.
    pub fn builder(pool: sqlx::PgPool) -> AppStateBuilder {
        AppStateBuilder {
            pool,
            jobs_enabled: false,
            misc: MiscConfig::default(),
            service_client: ServiceClientConfig::default(),
            clients: None,
            tracing_store: None,
            annotation_provider: None,
            browser_auth: BrowserAuthConfig::default(),
            mailer: MailSender::default(),
            auth_routes: AuthRouteConfig::default(),
            jobs: JobsConfig::default(),
            voxelytics: VoxelyticsConfig::default(),
        }
    }

    pub fn from_config(pool: sqlx::PgPool, config: &crate::config::Config) -> Self {
        Self::builder(pool)
            .jobs_enabled(config.jobs_enabled)
            .misc(config.misc.clone())
            .service_client(config.service_client.clone())
            .browser_auth(config.browser_auth.clone())
            .mailer(MailSender::from_config(&config.mail))
            .auth_routes(config.auth_routes.clone())
            .jobs(config.jobs.clone())
            .voxelytics(config.voxelytics.clone())
            .build()
    }
}

impl AppStateBuilder {
    pub fn jobs_enabled(mut self, enabled: bool) -> Self {
        self.jobs_enabled = enabled;
        self
    }

    pub fn misc(mut self, misc: MiscConfig) -> Self {
        self.misc = misc;
        self
    }

    pub fn service_client(mut self, config: ServiceClientConfig) -> Self {
        self.service_client = config;
        self
    }

    /// Datastore/tracingstore RPC clients other than the ones `service_client` configures.
    pub fn clients(mut self, clients: ServiceClients) -> Self {
        self.clients = Some(clients);
        self
    }

    pub fn browser_auth(mut self, config: BrowserAuthConfig) -> Self {
        self.browser_auth = config;
        self
    }

    pub fn mailer(mut self, mailer: MailSender) -> Self {
        self.mailer = mailer;
        self
    }

    pub fn auth_routes(mut self, config: AuthRouteConfig) -> Self {
        self.auth_routes = config;
        self
    }

    pub fn jobs(mut self, config: JobsConfig) -> Self {
        self.jobs = config;
        self
    }

    pub fn voxelytics(mut self, config: VoxelyticsConfig) -> Self {
        self.voxelytics = config;
        self
    }

    /// A tracing-store client other than the one `service_client` configures.
    pub fn tracing_store(mut self, client: TracingStoreClient) -> Self {
        self.tracing_store = Some(client);
        self
    }

    /// An annotation provider other than the one built on this state's tracing-store client.
    pub fn annotation_provider(mut self, provider: AnnotationProvider) -> Self {
        self.annotation_provider = Some(provider);
        self
    }

    pub fn build(self) -> AppState {
        let clients = self.clients.unwrap_or_else(|| {
            ServiceClients::new(self.service_client.clone())
                .expect("validated service client configuration")
        });
        let tracing_store = self.tracing_store.unwrap_or_else(|| {
            TracingStoreClient::new(self.service_client.clone())
                .expect("validated service client configuration")
        });
        let annotation_provider = self
            .annotation_provider
            .unwrap_or_else(|| AnnotationProvider::new(self.pool.clone(), tracing_store.clone()));
        AppState {
            pool: self.pool,
            jobs_enabled: JobsEnabled(self.jobs_enabled),
            misc: MiscState::new(self.misc),
            clients,
            tracing_store,
            annotation_provider,
            browser_auth: self.browser_auth,
            mailer: self.mailer,
            auth_routes: self.auth_routes,
            jobs: self.jobs,
            voxelytics: Voxelytics::new(self.voxelytics),
        }
    }
}
