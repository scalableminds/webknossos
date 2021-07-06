START TRANSACTION;

ALTER TABLE webknossos.jobs
  ADD CONSTRAINT owner_ref FOREIGN KEY(_owner) REFERENCES webknossos.users(_id) DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 73;

COMMIT TRANSACTION;
