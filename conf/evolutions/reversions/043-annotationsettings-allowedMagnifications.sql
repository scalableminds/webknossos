START TRANSACTION;

DROP VIEW webknossos.taskTypes_;
ALTER TABLE webknossos.taskTypes DROP settings_allowedMagnifications;


CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 42;

COMMIT TRANSACTION;
