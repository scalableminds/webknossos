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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        time::Duration,
    };

    struct Dropped(Arc<AtomicBool>);
    impl Drop for Dropped {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn server_failure_stops_background_without_waiting_for_signal() {
        let dropped = Arc::new(AtomicBool::new(false));
        let guard = Dropped(dropped.clone());
        let job = tokio::spawn(async move {
            let _guard = guard;
            std::future::pending::<()>().await;
        });
        tokio::task::yield_now().await;
        let mut server = tokio::spawn(async { Err(std::io::Error::other("server failed")) });
        let (stop_tx, _) = tokio::sync::oneshot::channel();
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            supervise_server(
                &mut server,
                vec![job],
                stop_tx,
                Duration::from_secs(1),
                std::future::pending(),
            ),
        )
        .await
        .unwrap();
        assert!(result.unwrap_err().to_string().contains("server failed"));
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn signal_requests_graceful_drain() {
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
        let mut server = tokio::spawn(async move {
            stop_rx.await.unwrap();
            Ok(())
        });
        supervise_server(
            &mut server,
            vec![],
            stop_tx,
            Duration::from_secs(1),
            async {},
        )
        .await
        .unwrap();
        assert!(server.is_finished());
    }

    #[tokio::test]
    async fn drain_timeout_aborts_server() {
        let dropped = Arc::new(AtomicBool::new(false));
        let guard = Dropped(dropped.clone());
        let mut server = tokio::spawn(async move {
            let _guard = guard;
            std::future::pending::<()>().await;
            Ok(())
        });
        tokio::task::yield_now().await;
        let (stop_tx, _) = tokio::sync::oneshot::channel();
        supervise_server(
            &mut server,
            vec![],
            stop_tx,
            Duration::from_millis(1),
            async {},
        )
        .await
        .unwrap();
        assert!(server.is_finished());
        assert!(dropped.load(Ordering::SeqCst));
    }
}
