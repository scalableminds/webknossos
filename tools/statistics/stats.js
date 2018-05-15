const { Client } = require("pg");
const fetch = require("node-fetch");

const HOST = "http://localhost:9000";

const MIN_MOVE_ACTIONS = 50;
const MIN_RATIO_FUNCTION = tracingTimeInHours =>
  Math.max(1.5, Math.min(10.0, 10.0 / tracingTimeInHours));
const MIN_NODES_PER_HOUR = 500;
const LAST_X_DAYS = 7;
const MIN_TRACING_MINUTES = 15;

const ANNOTATIONS_SQL = `
SELECT annotations._id, tracing_id, _user, _task, firstname, lastname, modified, tracingtime
FROM webknossos.annotations
JOIN webknossos.users ON webknossos.annotations._user=webknossos.users._id
WHERE DATE_PART('day', now() - modified) <= ${LAST_X_DAYS}
AND _task IS NOT NULL;`;

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function connect() {
  const client = new Client();
  await client.connect();

  let res;
  try {
    res = await client.query(ANNOTATIONS_SQL);
  } catch (err) {
    console.log(err);
    process.exit();
  }
  const TOKEN = "INSERT_TOKEN";

  console.log(
    `Configuration:
    Minimum number of move actions: ${MIN_MOVE_ACTIONS}
    Minimum number of nodes per hour: ${MIN_NODES_PER_HOUR}
    Minimum number of minutes traced: ${MIN_TRACING_MINUTES}
    Annotations that were modified in the last ${LAST_X_DAYS} days.
    `,
  );

  console.log(`Checking ${res.rows.length} annotations.`);

  for (const entry of res.rows) {
    const url = `${HOST}/data/tracings/skeleton/${
      entry.tracing_id
    }/updateActionStatistics?token=${TOKEN}`;

    await sleep(200);

    try {
      const response = await fetch(url);
      // eslint-disable-next-line no-await-in-loop
      const parsedJSON = await response.json();

      const {
        updateTracingActionCount: moved,
        createNodeActionCount: created,
        deleteNodeActionCount: deleted,
      } = parsedJSON;
      const movedToCreatedRatio = Math.round(moved / created * 10) / 10;
      const effectivelyCreatedNodes = created - deleted;
      const tracingTimeInSeconds = Math.round(entry.tracingtime / 1000);
      const tracingTimeInHours = tracingTimeInSeconds / 3600;
      const tracingTimeMinutes = Math.floor(tracingTimeInSeconds / 60);
      const tracingTimeSeconds =
        tracingTimeMinutes > 0
          ? tracingTimeInSeconds % (tracingTimeMinutes * 60)
          : tracingTimeInSeconds;
      const dynamicMinRatio = MIN_RATIO_FUNCTION(tracingTimeInHours);
      const nodesPerHour = effectivelyCreatedNodes / tracingTimeInHours;

      if (
        moved >= MIN_MOVE_ACTIONS &&
        nodesPerHour < MIN_NODES_PER_HOUR &&
        tracingTimeMinutes >= MIN_TRACING_MINUTES
      ) {
        console.log(
          `Moved: ${moved}, Created: ${created}, Deleted: ${deleted}, Nodes/Hour: ${nodesPerHour} - User: ${
            entry.firstname
          } ${entry.lastname}, TracingTime: ${tracingTimeMinutes}m${tracingTimeSeconds}s, TaskId: ${
            entry._task
          }, AnnotationId: ${entry._id}, TracingId: ${entry.tracing_id} ,Modified: ${
            entry.modified
          }`,
        );
      }
    } catch (err) {
      console.log(err);
      continue;
    }
  }

  await client.end();
}

connect();
