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
    let mut server = tokio::spawn(async move {
        axum::serve(listener, router(state))
            .with_graceful_shutdown(async {
                let _ = stop_rx.await;
            })
            .await
    });

    let mut background = vec![status_ping, orphan_clean_up];
    if let Some(watcher) = source_watcher {
        background.push(watcher);
    }
    supervise_server(
        &mut server,
        background,
        stop_tx,
        shutdown_timeout,
        shutdown_signal(),
    )
    .await
}

async fn supervise_server(
    server: &mut tokio::task::JoinHandle<std::io::Result<()>>,
    background: Vec<tokio::task::JoinHandle<()>>,
    stop_tx: tokio::sync::oneshot::Sender<()>,
    shutdown_timeout: std::time::Duration,
    signal: impl std::future::Future<Output = ()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let server_result = tokio::select! {
        () = signal => {
            tracing::info!("shutdown requested, draining in-flight requests");
            None
        },
        result = &mut *server => Some(result),
    };
    for job in background {
        job.abort();
        let _ = job.await;
    }
    if let Some(joined) = server_result {
        joined??;
    } else {
        let _ = stop_tx.send(());
        match tokio::time::timeout(shutdown_timeout, &mut *server).await {
            Ok(joined) => joined??,
            Err(_) => {
                tracing::warn!(
                    ?shutdown_timeout,
                    "in-flight requests did not finish before the shutdown timeout"
                );
                server.abort();
                let _ = server.await;
            }
        }
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

// `tests` is the library's test module in this directory.
#[cfg(test)]
mod main_tests;
