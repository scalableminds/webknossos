-- https://github.com/scalableminds/webknossos/pull/3117


START TRANSACTION;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets ADD COLUMN sortingKey TIMESTAMPTZ;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.dataSets SET sortingKey = created;
ALTER TABLE webknossos.dataSets ALTER COLUMN sortingKey SET NOT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 25;

COMMIT TRANSACTION;
