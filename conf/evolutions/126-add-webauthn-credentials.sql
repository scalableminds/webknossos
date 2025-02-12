START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 126, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TABLE webknossos.webauthnCredentials(
  _id TEXT PRIMARY KEY,
  _multiUser CHAR(24) NOT NULL,
  name TEXT NOT NULL,
  publicKeyCode BYTEA NOT NULL,
  signatureCount INTEGER NOT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE webknossos.webauthnCredentials
  ADD FOREIGN KEY (_multiUser) REFERENCES webknossos.multiUsers(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 127;

COMMIT TRANSACTION;
