//! Scala `RedisTemporaryStore` key/value and set commands over one lazily (re)connected RESP
//! connection. Commands are serialized on the connection like Lettuce's single connection does.
//!
//! Failure shapes follow Scala: connection problems are `Redis access exception on <authority>:
//! <message>`; command failures are wrapped with `Redis access failure`. A missing key is
//! `Ok(None)` (Scala `Fox.empty`).
use std::{sync::Arc, time::Duration};

use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufStream},
    net::TcpStream,
    sync::Mutex,
};

use crate::{
    config::RedisConfig,
    error::{DsError, DsResult},
};

/// Scala `connectionTimeout`.
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(1);
/// Scala `commandTimeout`.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_BULK_LENGTH: usize = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    Simple(String),
    Error(String),
    Integer(i64),
    Bulk(Option<Vec<u8>>),
    Array(Option<Vec<Reply>>),
}

#[derive(Clone)]
pub struct RedisStore {
    authority: String,
    address: String,
    port: u16,
    connection: Arc<Mutex<Option<BufStream<TcpStream>>>>,
}

fn encode(args: &[&[u8]]) -> Vec<u8> {
    let mut out = format!("*{}\r\n", args.len()).into_bytes();
    for arg in args {
        out.extend_from_slice(format!("${}\r\n", arg.len()).as_bytes());
        out.extend_from_slice(arg);
        out.extend_from_slice(b"\r\n");
    }
    out
}

async fn read_line(stream: &mut BufStream<TcpStream>) -> std::io::Result<String> {
    let mut line = Vec::new();
    stream.read_until(b'\n', &mut line).await?;
    if !line.ends_with(b"\r\n") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "Redis closed the connection or sent an incomplete reply",
        ));
    }
    line.truncate(line.len() - 2);
    Ok(String::from_utf8_lossy(&line).into_owned())
}

fn protocol_error(message: impl Into<String>) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.into())
}

fn read_reply(
    stream: &mut BufStream<TcpStream>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = std::io::Result<Reply>> + Send + '_>> {
    Box::pin(async move {
        let line = read_line(stream).await?;
        let (kind, rest) = line
            .split_at_checked(1)
            .ok_or_else(|| protocol_error("empty Redis reply"))?;
        let number = |s: &str| {
            s.parse::<i64>()
                .map_err(|_| protocol_error(format!("invalid Redis length {s}")))
        };
        Ok(match kind {
            "+" => Reply::Simple(rest.to_owned()),
            "-" => Reply::Error(rest.to_owned()),
            ":" => Reply::Integer(number(rest)?),
            "$" => {
                let length = number(rest)?;
                if length < 0 {
                    Reply::Bulk(None)
                } else {
                    let length = length as usize;
                    if length > MAX_BULK_LENGTH {
                        return Err(protocol_error("Redis bulk reply too large"));
                    }
                    let mut data = vec![0u8; length + 2];
                    stream.read_exact(&mut data).await?;
                    data.truncate(length);
                    Reply::Bulk(Some(data))
                }
            }
            "*" => {
                let count = number(rest)?;
                if count < 0 {
                    Reply::Array(None)
                } else {
                    let mut items = Vec::with_capacity(count.min(1 << 16) as usize);
                    for _ in 0..count {
                        items.push(read_reply(stream).await?);
                    }
                    Reply::Array(Some(items))
                }
            }
            other => return Err(protocol_error(format!("unknown Redis reply type {other}"))),
        })
    })
}

impl RedisStore {
    pub fn new(config: &RedisConfig) -> Self {
        Self {
            authority: config.authority(),
            address: config.address.clone(),
            port: config.port,
            connection: Arc::default(),
        }
    }

    pub fn authority(&self) -> &str {
        &self.authority
    }

    /// One command; reconnects lazily and drops the connection after IO errors.
    pub async fn command(&self, args: &[&[u8]]) -> DsResult<Reply> {
        let mut guard = self.connection.lock().await;
        if guard.is_none() {
            let connect = TcpStream::connect((self.address.as_str(), self.port));
            let stream = match tokio::time::timeout(CONNECTION_TIMEOUT, connect).await {
                Ok(Ok(stream)) => stream,
                Ok(Err(e)) => {
                    let message = format!("Redis access exception on {}: {e}", self.authority);
                    tracing::error!("{message}");
                    return Err(DsError::failure(message));
                }
                Err(_) => {
                    let message = format!(
                        "Redis access exception on {}: connection timed out after 1 second",
                        self.authority
                    );
                    tracing::error!("{message}");
                    return Err(DsError::failure(message));
                }
            };
            *guard = Some(BufStream::new(stream));
        }
        let stream = guard.as_mut().expect("connected above");
        let request = encode(args);
        let exchange = async {
            stream.write_all(&request).await?;
            stream.flush().await?;
            read_reply(stream).await
        };
        let result = match tokio::time::timeout(COMMAND_TIMEOUT, exchange).await {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(e)) => Err(DsError::from_exception(format!("java.io.IOException: {e}"))),
            Err(_) => Err(DsError::from_exception(
                "io.lettuce.core.RedisCommandTimeoutException: Command timed out after 1 minute(s)",
            )),
        };
        match result {
            Ok(Reply::Error(message)) => Err(DsError::from_exception(format!(
                "io.lettuce.core.RedisCommandExecutionException: {message}"
            ))
            .wrap("Redis access failure")),
            Ok(reply) => Ok(reply),
            Err(e) => {
                *guard = None;
                Err(e.wrap("Redis access failure"))
            }
        }
    }

    fn unexpected(reply: &Reply) -> DsError {
        DsError::failure(format!("Unexpected Redis reply: {reply:?}")).wrap("Redis access failure")
    }

    async fn integer(&self, args: &[&[u8]]) -> DsResult<i64> {
        match self.command(args).await? {
            Reply::Integer(v) => Ok(v),
            other => Err(Self::unexpected(&other)),
        }
    }

    async fn ok(&self, args: &[&[u8]]) -> DsResult<()> {
        match self.command(args).await? {
            Reply::Simple(_) | Reply::Integer(_) => Ok(()),
            other => Err(Self::unexpected(&other)),
        }
    }

    /// Scala `find`.
    pub async fn find(&self, key: &str) -> DsResult<Option<String>> {
        match self.command(&[b"GET", key.as_bytes()]).await? {
            Reply::Bulk(None) => Ok(None),
            Reply::Bulk(Some(bytes)) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
            other => Err(Self::unexpected(&other)),
        }
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
                let seconds = expiry.as_secs().to_string();
                self.ok(&[
                    b"SETEX",
                    key.as_bytes(),
                    seconds.as_bytes(),
                    value.as_bytes(),
                ])
                .await
            }
            None => self.ok(&[b"SET", key.as_bytes(), value.as_bytes()]).await,
        }
    }

    /// Scala `contains`.
    pub async fn contains(&self, key: &str) -> DsResult<bool> {
        Ok(self.integer(&[b"EXISTS", key.as_bytes()]).await? > 0)
    }

    /// Scala `remove`.
    pub async fn remove(&self, key: &str) -> DsResult<()> {
        self.integer(&[b"DEL", key.as_bytes()]).await.map(|_| ())
    }

    /// Scala `expire`.
    pub async fn expire(&self, key: &str, expiry: Duration) -> DsResult<()> {
        let seconds = expiry.as_secs().to_string();
        self.integer(&[b"EXPIRE", key.as_bytes(), seconds.as_bytes()])
            .await
            .map(|_| ())
    }

    /// Scala `ttlSeconds`: -1 without expiry, -2 for missing keys.
    pub async fn ttl_seconds(&self, key: &str) -> DsResult<i64> {
        self.integer(&[b"TTL", key.as_bytes()]).await
    }

    /// Scala `insertIntoSet`: whether the value was new.
    pub async fn insert_into_set(
        &self,
        key: &str,
        value: &str,
        expiry: Option<Duration>,
    ) -> DsResult<bool> {
        let added = self
            .integer(&[b"SADD", key.as_bytes(), value.as_bytes()])
            .await?
            > 0;
        if let Some(expiry) = expiry {
            self.expire(key, expiry).await?;
        }
        Ok(added)
    }

    /// Scala `isContainedInSet`.
    pub async fn is_contained_in_set(&self, key: &str, value: &str) -> DsResult<bool> {
        Ok(self
            .integer(&[b"SISMEMBER", key.as_bytes(), value.as_bytes()])
            .await?
            > 0)
    }

    /// Scala `removeFromSet`.
    pub async fn remove_from_set(&self, key: &str, value: &str) -> DsResult<bool> {
        Ok(self
            .integer(&[b"SREM", key.as_bytes(), value.as_bytes()])
            .await?
            > 0)
    }

    /// Scala `findSet` (missing keys are empty sets).
    pub async fn find_set(&self, key: &str) -> DsResult<Vec<String>> {
        match self.command(&[b"SMEMBERS", key.as_bytes()]).await? {
            Reply::Array(Some(items)) => items
                .into_iter()
                .map(|item| match item {
                    Reply::Bulk(Some(bytes)) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
                    other => Err(Self::unexpected(&other)),
                })
                .collect(),
            Reply::Array(None) => Ok(Vec::new()),
            other => Err(Self::unexpected(&other)),
        }
    }
}
