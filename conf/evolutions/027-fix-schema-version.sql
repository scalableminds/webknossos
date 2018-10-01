-- https://github.com/scalableminds/webknossos/pull/x


START TRANSACTION;

UPDATE webknossos.releaseInformation SET schemaVersion = 27;

COMMIT TRANSACTION;
