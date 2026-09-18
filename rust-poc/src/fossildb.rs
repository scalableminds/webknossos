//! Minimal read-only client for FossilDB's gRPC `Get` RPC. FossilDB stores values as
//! fully opaque bytes (see `webknossos-datastore/proto/fossildbapi.proto`), so this
//! never needs to know what's inside them — callers just forward `Vec<u8>` onward.

use tonic::transport::Channel;
use tonic::Request;

pub mod proto {
    tonic::include_proto!("com.scalableminds.fossildb.proto");
}

use proto::fossil_db_client::FossilDbClient;
use proto::GetRequest;

/// Fetches one key from one collection at its newest version. Mirrors the Scala
/// `FossilDBClient.get` (`webknossos-tracingstore/app/.../tracings/FossilDBClient.scala`)
/// with `mayBeEmpty = true`: `Ok(None)` means "no such key", not an error.
pub async fn get_raw(
    channel: Channel,
    collection: &str,
    key: &str,
) -> Result<Option<Vec<u8>>, tonic::Status> {
    let mut client = FossilDbClient::new(channel);
    let reply = client
        .get(Request::new(GetRequest {
            collection: collection.to_string(),
            key: key.to_string(),
            version: None,
            may_be_empty: Some(true),
        }))
        .await?
        .into_inner();

    if reply.success {
        Ok(Some(reply.value))
    } else {
        Ok(None)
    }
}
