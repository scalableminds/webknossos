const { Client } = require("pg");
const moment = require("moment");

// This script queries the database for annotations that are part of a task and fulfill certain criteria.
// In its current state it queries for annotations that were traced for at least MIN_TRACING_MINUTES without
// setting at least MIN_NODES_PER_HOUR nodes per hour.

// Usage: PGUSER=postgres PGPASSWORD=postgres PGDATABASE=webknossos PGPORT=5432 PGHOST=localhost node tools/statistics/get_statistics.js
// Adapt values for user, password, and host accordingly.

const MIN_NODES_PER_HOUR = 100;
const LAST_X_DAYS = 2 * 365;
const MIN_TRACING_MINUTES = 60;

const ANNOTATIONS_SQL = `
SELECT annotations._id, tracing_id, _task, firstname, lastname, modified,
  annotations.tracingtime, json_extract_path_text(statistics::json,'nodeCount') AS nodecount,
  _project, projects.name
FROM webknossos.annotations
JOIN webknossos.users ON webknossos.annotations._user=webknossos.users._id
JOIN webknossos.tasks ON webknossos.annotations._task=webknossos.tasks._id
JOIN webknossos.projects ON webknossos.tasks._project=webknossos.projects._id
WHERE DATE_PART('day', now() - modified) <= ${LAST_X_DAYS}
AND _task IS NOT NULL
AND (annotations.tracingtime / 1000 / 60) > ${MIN_TRACING_MINUTES}
AND json_extract_path_text(statistics::json,'nodeCount')::integer / (GREATEST(annotations.tracingtime, 1000) / 1000.0 / 3600.0) < ${MIN_NODES_PER_HOUR}
ORDER BY modified;`;

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

  console.log(
    `Configuration:
    Minimum number of nodes per hour: ${MIN_NODES_PER_HOUR}
    Minimum number of minutes traced: ${MIN_TRACING_MINUTES}
    Annotations that were modified in the last ${LAST_X_DAYS} days.
    `,
  );

  console.log(`Found ${res.rows.length} annotations.`);
  console.log("");

  for (const entry of res.rows) {
    const duration = moment.duration(Number.parseInt(entry.tracingtime, 10));
    const tracingTimeSeconds = Math.floor(duration.seconds());
    const tracingTimeInMinutes = Math.floor(duration.asMinutes());
    const nodesPerHour = Math.round(entry.nodecount / duration.asHours());

    console.log(
      `Effectively created nodes: ${entry.nodecount}, Nodes/Hour: ${nodesPerHour} - User: ${entry.firstname} ${entry.lastname}, TracingTime: ${tracingTimeInMinutes}m${tracingTimeSeconds}s, TaskId: ${entry._task}, AnnotationId: ${entry._id}, TracingId: ${entry.tracing_id}, ProjectId: ${entry._project}, ProjectName: ${entry.name}, Modified: ${entry.modified}`,
    );
  }

  await client.end();
}

connect();
