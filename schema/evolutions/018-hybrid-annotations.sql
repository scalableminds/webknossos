-- https://github.com/scalableminds/webknossos/pull/2984


START TRANSACTION;

SET session_replication_role = replica;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations ADD COLUMN skeletonTracingId CHAR(36) UNIQUE;
ALTER TABLE webknossos.annotations ADD COLUMN volumeTracingId CHAR(36) UNIQUE;
UPDATE webknossos.annotations SET skeletonTracingId = tracing_id WHERE tracing_typ = 'skeleton';
UPDATE webknossos.annotations SET volumeTracingId = tracing_id WHERE tracing_typ = 'volume';
ALTER TABLE webknossos.annotations DROP COLUMN tracing_id; --cascades to index
ALTER TABLE webknossos.annotations DROP COLUMN tracing_typ;
ALTER TABLE webknossos.annotations ADD CONSTRAINT annotations_check1 CHECK (COALESCE(skeletonTracingId,volumeTracingId) IS NOT NULL);
CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

CREATE INDEX ON webknossos.annotations(skeletonTracingId);
CREATE INDEX ON webknossos.annotations(volumeTracingId);

DROP TYPE webknossos.ANNOTATION_TRACING_TYPE;

SET session_replication_role = DEFAULT;

UPDATE webknossos.releaseInformation SET schemaVersion = 18;

COMMIT TRANSACTION;
