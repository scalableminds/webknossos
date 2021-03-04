-- https://github.com/scalableminds/webknossos/pull/TODO

START TRANSACTION;

DROP VIEW webknossos.analytics_;
DROP TABLE webknossos.analytics;

UPDATE webknossos.releaseInformation SET schemaVersion = 67;

COMMIT TRANSACTION;
