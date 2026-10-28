//! WorkerDAO: the worker heartbeat query behind the liveness monitor.
use sqlx::PgConnection;

use super::WorkerHeartbeat;

pub(super) async fn find_all_heartbeats(
    connection: &mut PgConnection,
) -> Result<Vec<WorkerHeartbeat>, sqlx::Error> {
    sqlx::query_as(
        "SELECT _id AS id, name, lastHeartBeat AS last_heart_beat \
             FROM webknossos.workers_ ORDER BY created, _id",
    )
    .fetch_all(connection)
    .await
}
