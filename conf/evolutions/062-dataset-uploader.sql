-- https://github.com/scalableminds/webknossos/pull/5097

START TRANSACTION;

UPDATE webknossos.datasets ADD COLUMN _uploader CHAR(24);

ALTER TABLE webknossos.dataSets
  ADD CONSTRAINT uploader_ref FOREIGN KEY(_uploader) REFERENCES webknossos.users(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 62;

COMMIT TRANSACTION;
