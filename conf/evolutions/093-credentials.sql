START TRANSACTION;

CREATE TYPE webknossos.CREDENTIAL_TYPE AS ENUM ('HTTP_Basic_Auth', 'S3_Access_Key', 'HTTP_Token', 'GCS');
CREATE TABLE webknossos.credentials(
   _id CHAR(24) PRIMARY KEY,
   type webknossos.CREDENTIAL_TYPE NOT NULL,
   name VARCHAR(256) NOT NULL,
   identifier Text,
   secret Text,
   scope Text,
   filePath Text
);

UPDATE webknossos.releaseInformation
SET schemaVersion = 93;

COMMIT TRANSACTION;
