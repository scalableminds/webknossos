//! Scala `RedisTemporaryStore` key/value and set commands over one lazily (re)connected,
//! multiplexed `redis` connection: concurrent commands are pipelined on it like Lettuce's single
//! connection does.
//!
//! Failure shapes follow Scala: connection problems are `Redis access exception on <authority>:
//! <message>`; command failures are wrapped with `Redis access failure`. A missing key is
//! `Ok(None)` (Scala `Fox.empty`).
use std::{sync::Arc, time::Duration};

use redis::{
    AsyncConnectionConfig, Client, Cmd, ConnectionAddr, ConnectionInfo, FromRedisValue,
    IntoConnectionInfo, RedisConnectionInfo, RedisError, Value, aio::MultiplexedConnection, cmd,
};
use tokio::sync::Mutex;

use crate::{
    config::RedisConfig,
    error::{DsError, DsResult},
};

/// Scala `connectionTimeout`.
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(1);
/// Scala `commandTimeout`.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const COMMAND_TIMEOUT_EXCEPTION: &str =
    "io.lettuce.core.RedisCommandTimeoutException: Command timed out after 1 minute(s)";

/// The shared connection; `generation` identifies it so that a failed command only drops the
/// connection it ran on, not one another command has already re-established.
#[derive(Default)]
struct Slot {
    generation: u64,
    connection: Option<MultiplexedConnection>,
}

#[derive(Clone)]
pub struct RedisStore {
    authority: String,
    client: Client,
    slot: Arc<Mutex<Slot>>,
}

fn access_failure(error: DsError) -> DsError {
    error.wrap("Redis access failure")
}

/// A failure the connection survives: a Redis error reply or an unexpected reply type.
fn command_error(error: &RedisError) -> DsError {
    access_failure(match error.code() {
        Some(code) => DsError::from_exception(format!(
            "io.lettuce.core.RedisCommandExecutionException: {code}{}",
            error.detail().map(|d| format!(" {d}")).unwrap_or_default()
        )),
        None => DsError::failure(format!("Unexpected Redis reply: {error}")),
    })
}

fn lossy(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

impl RedisStore {
    pub fn new(config: &RedisConfig) -> Self {
        // RESP2 without `CLIENT SETINFO`: a connection sends nothing before the first command,
        // like Lettuce with default options.
        let info: ConnectionInfo = ConnectionAddr::Tcp(config.address.clone(), config.port)
            .into_connection_info()
            .expect("a TCP address is always a valid connection info")
            .set_redis_settings(RedisConnectionInfo::default().set_skip_set_lib_name());
        Self {
            authority: config.authority(),
            client: Client::open(info).expect("a TCP connection info is always valid"),
            slot: Arc::default(),
        }
    }

    pub fn authority(&self) -> &str {
        &self.authority
    }

    async fn connect(&self) -> DsResult<MultiplexedConnection> {
        // Timeouts are applied here and per command, so the redis crate's own are off.
        let config = AsyncConnectionConfig::new()
            .set_connection_timeout(None)
            .set_response_timeout(None);
        let connect = self
            .client
            .get_multiplexed_async_connection_with_config(&config);
        let message = match tokio::time::timeout(CONNECTION_TIMEOUT, connect).await {
            Ok(Ok(connection)) => return Ok(connection),
            Ok(Err(e)) => format!("Redis access exception on {}: {e}", self.authority),
            Err(_) => format!(
                "Redis access exception on {}: connection timed out after 1 second",
                self.authority
            ),
        };
        tracing::error!("{message}");
        Err(DsError::failure(message))
    }

    /// The shared connection, connecting first if there is none.
    async fn connection(&self) -> DsResult<(u64, MultiplexedConnection)> {
        let mut slot = self.slot.lock().await;
        if let Some(connection) = &slot.connection {
            return Ok((slot.generation, connection.clone()));
        }
        let connection = self.connect().await?;
        slot.generation += 1;
        slot.connection = Some(connection.clone());
        Ok((slot.generation, connection))
    }

    async fn drop_connection(&self, generation: u64) {
        let mut slot = self.slot.lock().await;
        if slot.generation == generation {
            slot.connection = None;
        }
    }

    /// One command. The timeout covers the exchange only; a timed-out command drops the
    /// connection. A kept connection may have been closed by Redis (restart, idle timeout) since
    /// its last use; like Lettuce's reconnect, a command that finds it dropped is retried once on
    /// a fresh connection (all commands used here are idempotent).
    async fn query_with_timeout<T: FromRedisValue>(
        &self,
        command: &Cmd,
        timeout: Duration,
        timeout_exception: &str,
    ) -> DsResult<T> {
        let mut attempts_left = if self.slot.lock().await.connection.is_some() {
            2
        } else {
            1
        };
        loop {
            attempts_left -= 1;
            let (generation, mut connection) = self.connection().await?;
            let error =
                match tokio::time::timeout(timeout, command.query_async(&mut connection)).await {
                    Ok(Ok(value)) => return Ok(value),
                    Ok(Err(e)) if e.is_connection_dropped() || e.is_unrecoverable_error() => {
                        self.drop_connection(generation).await;
                        if attempts_left > 0 {
                            continue;
                        }
                        DsError::from_exception(format!("java.io.IOException: {e}"))
                    }
                    Ok(Err(e)) => return Err(command_error(&e)),
                    Err(_) => {
                        self.drop_connection(generation).await;
                        DsError::from_exception(timeout_exception)
                    }
                };
            return Err(access_failure(error));
        }
    }

    async fn query<T: FromRedisValue>(&self, command: &Cmd) -> DsResult<T> {
        self.query_with_timeout(command, COMMAND_TIMEOUT, COMMAND_TIMEOUT_EXCEPTION)
            .await
    }

    /// Scala `checkHealth`: `PING` on the shared connection must answer `PONG` within one second.
    /// (A connection per check would leave a TIME_WAIT socket per health request.)
    pub async fn ping(&self) -> DsResult<()> {
        let reply: Value = self
            .query_with_timeout(
                &cmd("PING"),
                CONNECTION_TIMEOUT,
                "java.util.concurrent.TimeoutException: Redis PING timed out after 1 second",
            )
            .await?;
        let unexpected = match reply {
            Value::SimpleString(pong) if pong == "PONG" => return Ok(()),
            Value::SimpleString(other) => other,
            other => format!("{other:?}"),
        };
        Err(access_failure(DsError::failure(format!(
            "Unexpected Redis ping reply: {unexpected}"
        ))))
    }

    /// Scala `find`.
    pub async fn find(&self, key: &str) -> DsResult<Option<String>> {
        let value: Option<Vec<u8>> = self.query(cmd("GET").arg(key)).await?;
        Ok(value.map(lossy))
    }

    /// Scala `findLong` (`toLong` failures become failures).
    pub async fn find_long(&self, key: &str) -> DsResult<Option<i64>> {
        self.find(key)
            .await?
            .map(|v| {
                v.parse::<i64>().map_err(|_| {
                    DsError::failure(format!(
                        "java.lang.NumberFormatException: For input string: \"{v}\""
                    ))
                })
            })
            .transpose()
    }

    /// Scala `insert` (`SETEX` with an expiry, `SET` without).
    pub async fn insert(&self, key: &str, value: &str, expiry: Option<Duration>) -> DsResult<()> {
        match expiry {
            Some(expiry) => {
                self.query(cmd("SETEX").arg(key).arg(expiry.as_secs()).arg(value))
                    .await
            }
            None => self.query(cmd("SET").arg(key).arg(value)).await,
        }
    }

    /// Scala `contains`.
    pub async fn contains(&self, key: &str) -> DsResult<bool> {
        self.query(cmd("EXISTS").arg(key)).await
    }

    /// Scala `remove`.
    pub async fn remove(&self, key: &str) -> DsResult<()> {
        self.query(cmd("DEL").arg(key)).await
    }

    /// Scala `expire`.
    pub async fn expire(&self, key: &str, expiry: Duration) -> DsResult<()> {
        self.query(cmd("EXPIRE").arg(key).arg(expiry.as_secs()))
            .await
    }

    /// Scala `ttlSeconds`: -1 without expiry, -2 for missing keys.
    pub async fn ttl_seconds(&self, key: &str) -> DsResult<i64> {
        self.query(cmd("TTL").arg(key)).await
    }

    /// Scala `insertIntoSet`: whether the value was new.
    pub async fn insert_into_set(
        &self,
        key: &str,
        value: &str,
        expiry: Option<Duration>,
    ) -> DsResult<bool> {
        let added: bool = self.query(cmd("SADD").arg(key).arg(value)).await?;
        if let Some(expiry) = expiry {
            self.expire(key, expiry).await?;
        }
        Ok(added)
    }

    /// Scala `isContainedInSet`.
    pub async fn is_contained_in_set(&self, key: &str, value: &str) -> DsResult<bool> {
        self.query(cmd("SISMEMBER").arg(key).arg(value)).await
    }

    /// Scala `removeFromSet`.
    pub async fn remove_from_set(&self, key: &str, value: &str) -> DsResult<bool> {
        self.query(cmd("SREM").arg(key).arg(value)).await
    }

    /// Scala `findSet` (missing keys are empty sets).
    pub async fn find_set(&self, key: &str) -> DsResult<Vec<String>> {
        let members: Vec<Vec<u8>> = self.query(cmd("SMEMBERS").arg(key)).await?;
        Ok(members.into_iter().map(lossy).collect())
    }
}
