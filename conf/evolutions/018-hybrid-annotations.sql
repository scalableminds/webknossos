-- https://github.com/scalableminds/webknossos/pull/2984


START TRANSACTION;

SET session_replication_role = replica;


DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations ADD COLUMN skeletonTracingId CHAR(36);
ALTER TABLE webknossos.annotations ADD COLUMN volumeTracingId CHAR(36);
UPDATE webknossos.annotations SET skeletonTracingId = tracing_id WHERE tracing_typ = 'skeleton';
UPDATE webknossos.annotations SET volumeTracingId = tracing_id WHERE tracing_typ = 'volume';
ALTER TABLE webknossos.annotations DROP COLUMN tracing_id;
ALTER TABLE webknossos.annotations DROP COLUMN tracing_typ;
ALTER TABLE webknossos.annotations ADD CONSTRAINT aName CHECK (COALESCE(skeletonTracingId,volumeTracingId) IS NOT NULL);
CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

DROP TYPE webknossos.ANNOTATION_TRACING_TYPE;

UPDATE webknossos.releaseInformation SET schemaVersion = 18;

COMMIT TRANSACTION;
