START TRANSACTION;

CREATE TYPE webknossos.CREDENTIAL_TYPE AS ENUM ('HTTP_Basic_Auth', 'S3_Access_Key', 'HTTP_Token', 'GCS');
CREATE TABLE webknossos.credentials(
   _id CHAR(24) PRIMARY KEY,
   type webknossos.CREDENTIAL_TYPE NOT NULL,
   name VARCHAR(256) NOT NULL,
   identifier Text,
   secret Text,
   _user CHAR(24) NOT NULL,
   _organization CHAR(24) NOT NULL,
   created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE VIEW webknossos.credentials_ as SELECT * FROM webknossos.credentials WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation
SET schemaVersion = 97;

COMMIT TRANSACTION;
