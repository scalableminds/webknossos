-- https://github.com/scalableminds/webknossos/pull/x


START TRANSACTION;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets ADD COLUMN sortingKey VARCHAR(256) NOT NULL;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 25;
UPDATE webknossos.dataSets SET sortingKey = created;

COMMIT TRANSACTION;
