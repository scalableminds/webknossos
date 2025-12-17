START TRANSACTION;

DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets ADD COLUMN tags VARCHAR(256)[] NOT NULL DEFAULT '{}';

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 79;

COMMIT TRANSACTION;
