use crate::{
    stores::{
        client::{ServiceClientConfig, ServiceClients},
        tracing_client::TracingStoreClient,
    },
    system::application_info::{MiscConfig, MiscState},
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
        }
    }

    pub fn from_config(pool: sqlx::PgPool, config: &crate::config::Config) -> Self {
        Self::builder(pool)
            .jobs_enabled(config.jobs_enabled)
            .misc(config.misc.clone())
            .service_client(config.service_client.clone())
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

    /// A tracing-store client other than the one `service_client` configures.
    pub fn tracing_store(mut self, client: TracingStoreClient) -> Self {
        self.tracing_store = Some(client);
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
        AppState {
            pool: self.pool,
            jobs_enabled: JobsEnabled(self.jobs_enabled),
            misc: MiscState::new(self.misc),
            clients,
            tracing_store,
        }
    }
}
