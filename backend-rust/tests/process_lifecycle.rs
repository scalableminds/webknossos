mod common;

use common::TestDb;
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    time::Duration,
};

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        // This handle is exclusively the child spawned by this test.
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(database_url: &str, address: SocketAddr) -> Server {
    Server(
        Command::new(env!("CARGO_BIN_EXE_webknossos-backend"))
            .env("DATABASE_URL", database_url)
            .env("WK_BIND", address.to_string())
            .env("WK_DB_MIN_CONNECTIONS", "1")
            .env("WK_DB_MAX_CONNECTIONS", "2")
            .env("WK_SHUTDOWN_TIMEOUT_SECONDS", "2")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start the built Rust backend"),
    )
}

fn get(address: SocketAddr, path: &str) -> std::io::Result<String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(100))?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response)
}

async fn wait_for_exit(server: &mut Server) -> std::process::ExitStatus {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(status) = server.0.try_wait().unwrap() {
                break status;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("server exits within its deadline")
}

#[tokio::test]
#[ignore = "requires WK_RUST_TEST_DATABASE_URL with CREATEDB and local TCP binding"]
async fn executable_serves_checks_schema_and_shuts_down_cleanly() {
    let db = TestDb::new().await;
    let fixture = db.fixture().await;
    // Reserve an available loopback address just before launching the child.
    let reservation = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);
    let mut server = start(&db.connection_url(), address);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            assert!(
                server.0.try_wait().unwrap().is_none(),
                "backend exited during startup"
            );
            if get(address, "/health/ready").is_ok_and(|body| body.starts_with("HTTP/1.1 200")) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("server becomes ready");
    assert!(
        get(address, "/api/v16/teams")
            .unwrap()
            .starts_with("HTTP/1.1 401")
    );
    let response = get(address, &format!("/api/v16/teams?token={}", fixture.token)).unwrap();
    assert!(response.starts_with("HTTP/1.1 200"));
    assert!(response.contains(&fixture.team_id));

    #[cfg(unix)]
    {
        assert!(
            Command::new("kill")
                .args(["-TERM", &server.0.id().to_string()])
                .status()
                .unwrap()
                .success()
        );
        assert!(wait_for_exit(&mut server).await.success());
    }
    #[cfg(not(unix))]
    server.0.kill().unwrap();
    drop(server);
    // A schema mismatch must stop startup; no existing records are altered.
    sqlx::query("UPDATE webknossos.releaseInformation SET schemaVersion=0")
        .execute(&db.pool)
        .await
        .unwrap();
    let mut incompatible = start(&db.connection_url(), address);
    assert!(!wait_for_exit(&mut incompatible).await.success());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM webknossos.teams")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    drop(incompatible);
    db.cleanup().await;
}
