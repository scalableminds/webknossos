START TRANSACTION;

DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets DROP CONSTRAINT uploader_ref;
ALTER TABLE webknossos.datasets DROP COLUMN _uploader;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 61;

COMMIT TRANSACTION;
