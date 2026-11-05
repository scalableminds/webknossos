//! Redis access (Scala `RedisTemporaryStore`): one lazily (re)connected, multiplexed connection
//! shared by the health check (`PING`, Scala `checkHealth`) and upload metadata, like Scala's
//! single Lettuce connection.
pub mod store;
