use crate::{
    annotation::provider::AnnotationProvider,
    auth::{browser::BrowserAuthConfig, routes::AuthRouteConfig},
    config::TimeTrackingConfig,
    dataset::options::DatasetRouteConfig,
    job::routes::JobsConfig,
    mail::MailSender,
    short_links::PublicUrl,
    slack::{SlackConfig, SlackNotificationService},
    stores::{
        client::{ServiceClientConfig, ServiceClients},
        tracing_client::TracingStoreClient,
    },
    system::application_info::{MiscConfig, MiscState},
    time::interaction_writer::{OverLimitNotifier, TimeInteractionWriter},
    users::{EmailVerification, notification_emails::NotificationEmailService},
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
    pub email_verification: EmailVerification,
    pub notification_emails: NotificationEmailService,
    pub public_url: PublicUrl,
    pub time_tracking: TimeTrackingConfig,
    /// One writer per app: its per-user cache and locks must be shared by all routes.
    pub time_interaction_writer: TimeInteractionWriter,
    pub slack: SlackNotificationService,
    pub datasets: DatasetRouteConfig,
    pub allow_delete_datasets: AllowDeleteDatasets,
}

/// `features.allowDeleteDatasets`.
#[derive(Clone, Copy, Debug)]
pub struct AllowDeleteDatasets(pub bool);

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
    email_verification: bool,
    notification_emails: Option<NotificationEmailService>,
    public_url: url::Url,
    time_tracking: TimeTrackingConfig,
    time_interaction_writer: Option<TimeInteractionWriter>,
    slack: SlackConfig,
    datasets: DatasetRouteConfig,
    allow_delete_datasets: bool,
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
            email_verification: true,
            notification_emails: None,
            public_url: url::Url::parse("http://localhost:9000").expect("valid default URL"),
            time_tracking: TimeTrackingConfig::default(),
            time_interaction_writer: None,
            slack: SlackConfig::default(),
            datasets: DatasetRouteConfig::default(),
            allow_delete_datasets: true,
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
            .email_verification(config.email_verification_enabled)
            .public_url(config.public_url.clone())
            .time_tracking(config.time_tracking)
            .slack(config.slack.clone())
            .datasets(config.datasets.clone())
            .allow_delete_datasets(config.allow_delete_datasets)
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

    pub fn email_verification(mut self, enabled: bool) -> Self {
        self.email_verification = enabled;
        self
    }

    pub fn public_url(mut self, url: url::Url) -> Self {
        self.public_url = url;
        self
    }

    pub fn time_tracking(mut self, config: TimeTrackingConfig) -> Self {
        self.time_tracking = config;
        self
    }

    pub fn slack(mut self, config: SlackConfig) -> Self {
        self.slack = config;
        self
    }

    pub fn datasets(mut self, config: DatasetRouteConfig) -> Self {
        self.datasets = config;
        self
    }

    pub fn allow_delete_datasets(mut self, allowed: bool) -> Self {
        self.allow_delete_datasets = allowed;
        self
    }

    /// A time-interaction writer other than the one `time_tracking` configures.
    pub fn time_interaction_writer(mut self, writer: TimeInteractionWriter) -> Self {
        self.time_interaction_writer = Some(writer);
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

    /// A notification-email service other than the one sending through `mailer`.
    pub fn notification_emails(mut self, service: NotificationEmailService) -> Self {
        self.notification_emails = Some(service);
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
        let notification_emails = self.notification_emails.unwrap_or_else(|| {
            NotificationEmailService::new(self.mailer.clone(), &self.browser_auth.public_uri)
        });
        let time_interaction_writer = self.time_interaction_writer.unwrap_or_else(|| {
            TimeInteractionWriter::new(
                Default::default(),
                self.time_tracking.interaction,
                OverLimitNotifier::new(self.mailer.clone(), self.public_url.as_str()),
            )
        });
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
            email_verification: EmailVerification(self.email_verification),
            notification_emails,
            public_url: PublicUrl(self.public_url),
            time_tracking: self.time_tracking,
            time_interaction_writer,
            slack: SlackNotificationService::new(&self.slack),
            datasets: self.datasets,
            allow_delete_datasets: AllowDeleteDatasets(self.allow_delete_datasets),
        }
    }
}
