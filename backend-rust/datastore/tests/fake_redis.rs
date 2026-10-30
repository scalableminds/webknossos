//! An in-process RESP server with the string/set commands of `RedisStore` (no expiry; TTLs are
//! recorded so tests can inspect them).
#![allow(dead_code)]

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};

use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Text(String),
    Set(BTreeSet<String>),
}

#[derive(Default)]
pub struct Data {
    pub entries: BTreeMap<String, Entry>,
    pub ttls: BTreeMap<String, i64>,
}

#[derive(Clone)]
pub struct FakeRedis {
    pub port: u16,
    pub data: Arc<Mutex<Data>>,
}

impl FakeRedis {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let data: Arc<Mutex<Data>> = Arc::default();
        let shared = Arc::clone(&data);
        tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    return;
                };
                let data = Arc::clone(&shared);
                tokio::spawn(async move {
                    let (read, mut write) = socket.into_split();
                    let mut reader = BufReader::new(read);
                    loop {
                        let Some(args) = read_command(&mut reader).await else {
                            return;
                        };
                        let reply = execute(&data, &args);
                        if write.write_all(&reply).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        Self { port, data }
    }

    pub fn text(&self, key: &str) -> Option<String> {
        match self.data.lock().unwrap().entries.get(key) {
            Some(Entry::Text(t)) => Some(t.clone()),
            _ => None,
        }
    }

    pub fn set(&self, key: &str) -> Option<BTreeSet<String>> {
        match self.data.lock().unwrap().entries.get(key) {
            Some(Entry::Set(s)) => Some(s.clone()),
            _ => None,
        }
    }

    pub fn keys(&self) -> Vec<String> {
        self.data.lock().unwrap().entries.keys().cloned().collect()
    }
}

async fn read_command<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> Option<Vec<String>> {
    let mut line = String::new();
    if reader.read_line(&mut line).await.ok()? == 0 {
        return None;
    }
    let count: usize = line.trim_end().strip_prefix('*')?.parse().ok()?;
    let mut args = Vec::with_capacity(count);
    for _ in 0..count {
        line.clear();
        reader.read_line(&mut line).await.ok()?;
        let length: usize = line.trim_end().strip_prefix('$')?.parse().ok()?;
        let mut buffer = vec![0u8; length + 2];
        reader.read_exact(&mut buffer).await.ok()?;
        buffer.truncate(length);
        args.push(String::from_utf8(buffer).ok()?);
    }
    Some(args)
}

fn bulk(value: &str) -> Vec<u8> {
    format!("${}\r\n{value}\r\n", value.len()).into_bytes()
}

fn int(value: i64) -> Vec<u8> {
    format!(":{value}\r\n").into_bytes()
}

fn execute(data: &Mutex<Data>, args: &[String]) -> Vec<u8> {
    let mut data = data.lock().unwrap();
    let key = args.get(1).cloned().unwrap_or_default();
    match args[0].to_ascii_uppercase().as_str() {
        "PING" => b"+PONG\r\n".to_vec(),
        "GET" => match data.entries.get(&key) {
            Some(Entry::Text(t)) => bulk(t),
            Some(Entry::Set(_)) => {
                b"-WRONGTYPE Operation against a key holding the wrong kind of value\r\n".to_vec()
            }
            None => b"$-1\r\n".to_vec(),
        },
        "SET" => {
            data.entries
                .insert(key.clone(), Entry::Text(args[2].clone()));
            data.ttls.remove(&key);
            b"+OK\r\n".to_vec()
        }
        "SETEX" => {
            data.entries
                .insert(key.clone(), Entry::Text(args[3].clone()));
            data.ttls.insert(key, args[2].parse().unwrap());
            b"+OK\r\n".to_vec()
        }
        "EXISTS" => int(i64::from(data.entries.contains_key(&key))),
        "DEL" => {
            data.ttls.remove(&key);
            int(i64::from(data.entries.remove(&key).is_some()))
        }
        "EXPIRE" => {
            if data.entries.contains_key(&key) {
                data.ttls.insert(key, args[2].parse().unwrap());
                int(1)
            } else {
                int(0)
            }
        }
        "TTL" => int(if data.entries.contains_key(&key) {
            data.ttls.get(&key).copied().unwrap_or(-1)
        } else {
            -2
        }),
        "SADD" => {
            let entry = data
                .entries
                .entry(key)
                .or_insert_with(|| Entry::Set(BTreeSet::new()));
            match entry {
                Entry::Set(set) => int(i64::from(set.insert(args[2].clone()))),
                Entry::Text(_) => b"-WRONGTYPE\r\n".to_vec(),
            }
        }
        "SISMEMBER" => int(i64::from(matches!(
            data.entries.get(&key),
            Some(Entry::Set(set)) if set.contains(&args[2])
        ))),
        "SREM" => match data.entries.get_mut(&key) {
            Some(Entry::Set(set)) => int(i64::from(set.remove(&args[2]))),
            _ => int(0),
        },
        "SMEMBERS" => match data.entries.get(&key) {
            Some(Entry::Set(set)) => {
                let mut out = format!("*{}\r\n", set.len()).into_bytes();
                for member in set {
                    out.extend(bulk(member));
                }
                out
            }
            _ => b"*0\r\n".to_vec(),
        },
        other => format!("-ERR unknown command '{other}'\r\n").into_bytes(),
    }
}
