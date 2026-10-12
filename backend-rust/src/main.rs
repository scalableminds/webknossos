use std::process::ExitCode;
use webknossos_backend::{AppState, config::Config, db, router_with_config};

#[tokio::main]
async fn main() -> ExitCode {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "webknossos_backend=info,tower_http=info".into());
    // JSON by default; LOG_FORMAT=pretty gives colored, human-readable lines for local dev.
    if std::env::var("LOG_FORMAT").is_ok_and(|format| format == "pretty") {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    } else {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    }
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
    let housekeeping = webknossos_backend::housekeeping::spawn(pool.clone(), &config.housekeeping);
    let credit_ticker = webknossos_backend::credit_ticker::spawn(
        pool.clone(),
        &config.credit_ticker,
        config.misc.monthly_free_milli_credits,
    );
    let used_storage_scan = webknossos_backend::dataset_storage::spawn(
        pool.clone(),
        webknossos_backend::service_clients::ServiceClients::new(config.service_client.clone())?,
        &config.used_storage,
    );
    let worker_liveness = webknossos_backend::worker_liveness::spawn(
        pool.clone(),
        &config.worker_liveness,
        config.jobs.worker_liveness_timeout,
    );
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(address = %listener.local_addr()?, "Rust application backend listening");
    let (shutdown_send, shutdown_recv) = tokio::sync::oneshot::channel();
    let server = axum::serve(
        listener,
        router_with_config(AppState { pool: pool.clone() }, &config),
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
    pool.close().await;
    Ok(())
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
