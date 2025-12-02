-- https://github.com/scalableminds/webknossos/pull/5092

START TRANSACTION;

DROP VIEW webknossos.userInfos;

UPDATE webknossos.releaseInformation SET schemaVersion = 60;

COMMIT TRANSACTION;
