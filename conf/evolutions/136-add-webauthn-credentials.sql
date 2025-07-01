START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 135, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

CREATE TABLE webknossos.webauthnCredentials(
  _id TEXT PRIMARY KEY,
  _multiUser TEXT NOT NULL,
  credentialId BYTEA NOT NULL,
  name TEXT NOT NULL,
  serializedAttestedCredential BYTEA NOT NULL,
  serializedExtensions TEXT NOT NULL,
  signatureCount INTEGER NOT NULL,
  isDeleted BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (_id, credentialId)
);

CREATE VIEW webknossos.webauthnCredentials_ as SELECT * FROM webknossos.webauthnCredentials WHERE NOT isDeleted;

ALTER TABLE webknossos.webauthnCredentials
  ADD FOREIGN KEY (_multiUser) REFERENCES webknossos.multiUsers(_id) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 136;

COMMIT TRANSACTION;
