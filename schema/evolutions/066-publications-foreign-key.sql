-- https://github.com/scalableminds/webknossos/pull/5216

START TRANSACTION;

ALTER TABLE webknossos.dataSets
  ADD CONSTRAINT publication_ref FOREIGN KEY(_publication) REFERENCES webknossos.publications(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 66;

COMMIT TRANSACTION;
