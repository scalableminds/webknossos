//! Redis access (Scala `RedisTemporaryStore`): one lazily (re)connected RESP connection shared by
//! the health check (`PING`, Scala `checkHealth`) and upload metadata, like Scala's single
//! Lettuce connection.
pub mod store;
