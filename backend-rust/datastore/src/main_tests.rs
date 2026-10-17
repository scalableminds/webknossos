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
    let guard = Dropped(Arc::clone(&dropped));
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
    let guard = Dropped(Arc::clone(&dropped));
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
