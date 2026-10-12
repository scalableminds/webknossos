use std::net::SocketAddr;

use tracing_subscriber::EnvFilter;
use webknossos_datastore::{AppState, config::DatastoreConfig, router};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = DatastoreConfig::from_env()?;
    if config.uses_default_key() {
        tracing::warn!("WK_DS_KEY is the Scala default; set a secret key in production");
    }
    if config.skipped_data_vault_credentials > 0 {
        tracing::warn!(
            skipped = config.skipped_data_vault_credentials,
            "ignored incomplete or unknown WK_DS_DATA_VAULTS_CREDENTIALS entries"
        );
    }
    tracing::info!(
        "Parsed {} global data vault credentials from datastore config.",
        config.data_vault_credentials.len()
    );

    let bind = SocketAddr::new(config.http.address, config.http.port);
    let shutdown_timeout = config.http.shutdown_timeout;
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(%bind, name = %config.name, "datastore listening");

    let state = AppState::new(config);
    // Scala `DSRemoteWebknossosClient` (IntervalScheduler): periodic status report to WEBKNOSSOS.
    let status_ping = state.wk_client.spawn_status_ping()?;
    let source_watcher = state
        .source_scanner
        .spawn_watcher(&state.config.watch_file_system)?;

    // Scala `UploadService`: orphan upload directories are removed once, 10 s after start.
    let orphan_clean_up = state.uploads.spawn_orphan_clean_up();

    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, router(state))
            .with_graceful_shutdown(async {
                let _ = stop_rx.await;
            })
            .await
    });

    shutdown_signal().await;
    tracing::info!("shutdown requested, draining in-flight requests");
    status_ping.abort();
    orphan_clean_up.abort();
    if let Some(watcher) = source_watcher {
        watcher.abort();
    }
    let _ = stop_tx.send(());
    match tokio::time::timeout(shutdown_timeout, server).await {
        Ok(joined) => joined??,
        Err(_) => tracing::warn!(
            ?shutdown_timeout,
            "in-flight requests did not finish before the shutdown timeout"
        ),
    }
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::error!(error = %e, "cannot listen for ctrl-c");
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(e) => {
                tracing::error!(error = %e, "cannot listen for SIGTERM");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
