-- https://github.com/scalableminds/webknossos/pull/4135

START TRANSACTION;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets ADD COLUMN inboxSourceHash INT;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 44;

COMMIT TRANSACTION;
