use std::process::ExitCode;
use webknossos_backend::{AppState, config::Config, db, router_with_config};

#[tokio::main]
async fn main() -> ExitCode {
    init_logging();
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "Backend stopped");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let slack = webknossos_backend::slack::install_global(&config.slack);
    let pool = db::connect(&config.database).await?;
    slack.notice_startup(&config.misc.build_info.version());
    let housekeeping =
        webknossos_backend::background::housekeeping::spawn(pool.clone(), &config.housekeeping);
    let credit_ticker = webknossos_backend::background::credit_ticker::spawn(
        pool.clone(),
        &config.credit_ticker,
        config.misc.monthly_free_milli_credits,
    );
    let used_storage_scan = webknossos_backend::organization::storage::spawn(
        pool.clone(),
        webknossos_backend::stores::client::ServiceClients::new(config.service_client.clone())?,
        &config.used_storage,
    );
    let worker_liveness = webknossos_backend::background::worker_liveness::spawn(
        pool.clone(),
        &config.worker_liveness,
        config.jobs.worker_liveness_timeout,
    );
    let metrics_server = match config.metrics_bind {
        Some(address) => {
            let listener = tokio::net::TcpListener::bind(address).await?;
            tracing::info!(address = %listener.local_addr()?, "Metrics listening");
            let router = webknossos_backend::system::metrics::router(
                pool.clone(),
                config.misc.build_info.version(),
                config.misc.build_info.commit_hash.clone(),
            );
            Some(tokio::spawn(async move {
                if let Err(error) = axum::serve(listener, router).await {
                    tracing::error!(%error, "Metrics server stopped");
                }
            }))
        }
        None => None,
    };
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(address = %listener.local_addr()?, "Rust application backend listening");
    let (shutdown_send, shutdown_recv) = tokio::sync::oneshot::channel();
    let server = axum::serve(
        listener,
        router_with_config(AppState::new(pool.clone()), &config),
    )
    .with_graceful_shutdown(async {
        let _ = shutdown_recv.await;
    });
    let server = std::future::IntoFuture::into_future(server);
    tokio::pin!(server);
    tokio::select! {
        result = &mut server => { result?; }
        _ = shutdown_signal() => {
            tracing::info!("Draining requests");
            let _ = shutdown_send.send(());
            match tokio::time::timeout(config.shutdown_timeout, &mut server).await {
                Ok(result) => result?,
                Err(_) => { tracing::warn!("Shutdown deadline exceeded"); return Ok(()); }
            }
        }
    }
    if tokio::time::timeout(config.shutdown_timeout, housekeeping.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("Housekeeping jobs did not stop before the shutdown deadline");
    }
    if tokio::time::timeout(config.shutdown_timeout, credit_ticker.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("Credit ticker did not stop before the shutdown deadline");
    }
    if tokio::time::timeout(config.shutdown_timeout, used_storage_scan.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("Used storage scan did not stop before the shutdown deadline");
    }
    if tokio::time::timeout(config.shutdown_timeout, worker_liveness.shutdown())
        .await
        .is_err()
    {
        tracing::warn!("Worker liveness monitor did not stop before the shutdown deadline");
    }
    if let Some(metrics_server) = metrics_server {
        metrics_server.abort();
    }
    pool.close().await;
    Ok(())
}

/// JSON logs by default; LOG_FORMAT=pretty gives colored, human-readable lines for local dev.
///
/// Plain `target=level` directives (the default and the documented RUST_LOG form) use the static
/// `Targets` filter. `EnvFilter` tracks every span and takes a lock on each span enter/exit; with
/// the per-request span entered on every poll, that lock dominated CPU under concurrency (5.5 ms
/// per request at 32 connections for a 300-row response). Span/field directives still work: they
/// fall back to `EnvFilter`.
fn init_logging() {
    use tracing_subscriber::{
        Layer, filter::Targets, layer::SubscriberExt, util::SubscriberInitExt,
    };
    let directives = std::env::var("RUST_LOG")
        .unwrap_or_else(|_| "webknossos_backend=info,tower_http=info".into());
    let filter = match directives.parse::<Targets>() {
        Ok(targets) => targets.boxed(),
        Err(_) => tracing_subscriber::EnvFilter::new(&directives).boxed(),
    };
    let format = if std::env::var("LOG_FORMAT").is_ok_and(|format| format == "pretty") {
        tracing_subscriber::fmt::layer().boxed()
    } else {
        tracing_subscriber::fmt::layer().json().boxed()
    };
    tracing_subscriber::registry()
        .with(filter)
        .with(format)
        .init();
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            }
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}
