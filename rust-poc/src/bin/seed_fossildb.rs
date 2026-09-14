//! Test-only helper: writes one raw value into a FossilDB collection/key via the `Put`
//! RPC, so `GET /annotation/:id/proto` has something real to fetch. Not part of the
//! PoC service itself — mirrors `gen_hash.rs`'s role for the login/me slice.
//!
//! Usage: seed_fossildb <collection> <key> <value-as-utf8-text>
//! Reads FOSSILDB_ADDRESS/FOSSILDB_PORT the same way the main service does
//! (defaults: localhost:7155).

use std::env;

mod proto {
    tonic::include_proto!("com.scalableminds.fossildb.proto");
}

use proto::fossil_db_client::FossilDbClient;
use proto::{DeleteRequest, GetRequest, PutRequest};

#[tokio::main]
async fn main() {
    let mut args = env::args().skip(1);
    let usage = "usage: seed_fossildb put <collection> <key> <value>\n       seed_fossildb delete <collection> <key>";
    let command = args.next().expect(usage);

    let address = env::var("FOSSILDB_ADDRESS").unwrap_or_else(|_| "localhost".to_string());
    let port = env::var("FOSSILDB_PORT").unwrap_or_else(|_| "7155".to_string());
    let mut client = FossilDbClient::connect(format!("http://{address}:{port}"))
        .await
        .expect("failed to connect to FossilDB");

    match command.as_str() {
        "put" => {
            let collection = args.next().expect(usage);
            let key = args.next().expect(usage);
            let value = args.next().expect(usage);
            let reply = client
                .put(PutRequest {
                    collection,
                    key,
                    version: None,
                    value: value.into_bytes(),
                })
                .await
                .expect("Put RPC failed")
                .into_inner();
            print_result(reply.success, reply.error_message);
        }
        "delete" => {
            let collection = args.next().expect(usage);
            let key = args.next().expect(usage);
            // Delete requires the exact version, so look up the current one first.
            let get_reply = client
                .get(GetRequest {
                    collection: collection.clone(),
                    key: key.clone(),
                    version: None,
                    may_be_empty: Some(true),
                })
                .await
                .expect("Get RPC failed")
                .into_inner();
            if !get_reply.success {
                println!("nothing to delete");
                return;
            }
            let reply = client
                .delete(DeleteRequest {
                    collection,
                    key,
                    version: get_reply.actual_version,
                })
                .await
                .expect("Delete RPC failed")
                .into_inner();
            print_result(reply.success, reply.error_message);
        }
        _ => panic!("{usage}"),
    }
}

fn print_result(success: bool, error_message: Option<String>) {
    if success {
        println!("ok");
    } else {
        println!("failed: {error_message:?}");
    }
}
