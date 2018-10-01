-- https://github.com/scalableminds/webknossos/pull/3294


START TRANSACTION;

UPDATE webknossos.releaseInformation SET schemaVersion = 27;

COMMIT TRANSACTION;
