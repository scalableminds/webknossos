
START TRANSACTION;

SET session_replication_role = replica;

CREATE TYPE webknossos.ANNOTATION_TRACING_TYPE AS ENUM ('skeleton', 'volume');

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations ADD COLUMN tracing_id CHAR(36) UNIQUE;
ALTER TABLE webknossos.annotations ADD COLUMN tracing_typ webknossos.ANNOTATION_TRACING_TYPE;
UPDATE webknossos.annotations SET tracing_id = skeletonTracingId WHERE skeletonTracingId IS NOT NULL;
UPDATE webknossos.annotations SET tracing_id = volumeTracingId WHERE volumeTracingId IS NOT NULL;
UPDATE webknossos.annotations SET tracing_typ = 'skeleton' WHERE skeletonTracingId IS NOT NULL;
UPDATE webknossos.annotations SET tracing_typ = 'volume' WHERE volumeTracingId IS NOT NULL;
ALTER TABLE webknossos.annotations DROP COLUMN skeletonTracingId; --cascades to index
ALTER TABLE webknossos.annotations DROP COLUMN volumeTracingId; --cascades to index
ALTER TABLE webknossos.annotations ALTER COLUMN tracing_id SET NOT NULL;
ALTER TABLE webknossos.annotations ALTER COLUMN tracing_typ SET NOT NULL;
CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

CREATE INDEX ON webknossos.annotations(tracing_id);

SET session_replication_role = DEFAULT;

UPDATE webknossos.releaseInformation SET schemaVersion = 17;

COMMIT TRANSACTION;
