START TRANSACTION;

DROP VIEW webknossos.taskTypes_;

ALTER TABLE webknossos.taskTypes DROP COLUMN tracingType;

CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

DROP TYPE webknossos.TASKTYPE_TRACINGTYPES;

UPDATE webknossos.releaseInformation SET schemaVersion = 38;

COMMIT TRANSACTION;
