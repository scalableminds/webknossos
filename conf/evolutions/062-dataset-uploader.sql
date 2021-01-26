-- https://github.com/scalableminds/webknossos/pull/5097

START TRANSACTION;

DROP VIEW webknossos.dataSets_;

ALTER TABLE webknossos.dataSets ADD COLUMN _uploader CHAR(24);

ALTER TABLE webknossos.dataSets
  ADD CONSTRAINT uploader_ref FOREIGN KEY(_uploader) REFERENCES webknossos.users(_id) DEFERRABLE;

CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 62;

COMMIT TRANSACTION;
