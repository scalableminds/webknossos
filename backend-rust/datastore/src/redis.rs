//! Minimal Redis access for the datastore health check (Scala `RedisTemporaryStore.checkHealth`).
//!
//! Only `PING` is implemented (RESP over a fresh TCP connection per check). Scala keeps one lazy
//! Lettuce connection; the observable health semantics (1 s connect timeout, 1 s ping timeout,
//! `PONG` expected, same failure messages) are the same. The general key/value client follows
//! with the first feature that stores data in Redis.

use std::time::Duration;

use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
};

use crate::{config::RedisConfig, error::DsError};

/// Scala `connectionTimeout` (also used as the ping timeout in `checkHealth`).
pub const CONNECTION_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_REPLY_LINE: usize = 4096;

/// Scala `checkHealth`: `PING` must answer `PONG` within one second.
pub async fn check_health(config: &RedisConfig) -> Result<(), DsError> {
    ping(config)
        .await
        .map_err(|e| e.wrap("Redis health check failed."))
}

async fn ping(config: &RedisConfig) -> Result<(), DsError> {
    let authority = config.authority();
    let connect = TcpStream::connect((config.address.as_str(), config.port));
    let stream = match tokio::time::timeout(CONNECTION_TIMEOUT, connect).await {
        Ok(Ok(stream)) => stream,
        // Scala `withCommands`: exceptions while (lazily) connecting become this plain failure.
        Ok(Err(e)) => {
            return Err(DsError::failure(format!(
                "Redis access exception on {authority}: {e}"
            )));
        }
        Err(_) => {
            return Err(DsError::failure(format!(
                "Redis access exception on {authority}: connection timed out after 1 second"
            )));
        }
    };
    tokio::time::timeout(CONNECTION_TIMEOUT, exchange_ping(stream))
        .await
        .unwrap_or_else(|_| {
            Err(DsError::from_exception(
                "java.util.concurrent.TimeoutException: Redis PING timed out after 1 second",
            ))
        })
        .map_err(|e| e.wrap("Redis access failure"))
}

async fn exchange_ping(mut stream: TcpStream) -> Result<(), DsError> {
    stream
        .write_all(b"*1\r\n$4\r\nPING\r\n")
        .await
        .map_err(DsError::from_exception)?;
    let mut reader = BufReader::new(stream).take(MAX_REPLY_LINE as u64);
    let mut line = Vec::new();
    reader
        .read_until(b'\n', &mut line)
        .await
        .map_err(DsError::from_exception)?;
    if !line.ends_with(b"\r\n") {
        return Err(DsError::from_exception(
            "java.io.IOException: Redis closed the connection or sent an incomplete reply",
        ));
    }
    let reply = String::from_utf8_lossy(&line[..line.len() - 2]).into_owned();
    match reply.split_at_checked(1) {
        Some(("+", "PONG")) => Ok(()),
        // Lettuce raises RedisCommandExecutionException for error replies (e.g. NOAUTH).
        Some(("-", message)) => Err(DsError::from_exception(format!(
            "io.lettuce.core.RedisCommandExecutionException: {message}"
        ))),
        Some(("+", other)) => Err(DsError::failure(format!(
            "Unexpected Redis ping reply: {other}"
        ))),
        _ => Err(DsError::failure(format!(
            "Unexpected Redis ping reply: {reply}"
        ))),
    }
}
