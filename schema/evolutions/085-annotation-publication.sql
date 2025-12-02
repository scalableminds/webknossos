START TRANSACTION;

DROP VIEW webknossos.annotations_;
ALTER TABLE webknossos.annotations
  ADD COLUMN _publication CHAR(24),
  ADD CONSTRAINT publication_ref FOREIGN KEY(_publication) REFERENCES webknossos.publications(_id) DEFERRABLE;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 85;

COMMIT TRANSACTION;
