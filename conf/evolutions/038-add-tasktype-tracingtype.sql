-- https://github.com/scalableminds/webknossos/pull/3712

START TRANSACTION;

CREATE TYPE webknossos.TASKTYPE_TRACINGTYPES AS ENUM ('skeleton', 'volume', 'hybrid');

DROP VIEW webknossos.taskTypes_;

ALTER TABLE webknossos.taskTypes ADD COLUMN tracingType webknossos.TASKTYPE_TRACINGTYPES NOT NULL DEFAULT 'skeleton';

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 38;

COMMIT TRANSACTION;
