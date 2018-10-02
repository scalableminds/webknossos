-- https://github.com/scalableminds/webknossos/pull/3137


START TRANSACTION;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets DROP CONSTRAINT "datasets_name_key";
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 27;

COMMIT TRANSACTION;
