START TRANSACTION;

DROP VIEW webknossos.credentials_;

ALTER TYPE webknossos.CREDENTIAL_TYPE RENAME TO CREDENTIAL_TYPE_NEW;
CREATE TYPE webknossos.CREDENTIAL_TYPE AS ENUM ('HTTP_Basic_Auth', 'S3_Access_Key', 'HTTP_Token', 'GCS');

ALTER TABLE webknossos.credentials
	ALTER COLUMN type TYPE webknossos.CREDENTIAL_TYPE USING
    CASE type
      WHEN 'HttpBasicAuth'::webknossos.CREDENTIAL_TYPE_NEW THEN 'HTTP_Basic_Auth'::webknossos.CREDENTIAL_TYPE
      WHEN 'HttpToken'::webknossos.CREDENTIAL_TYPE_NEW THEN 'HTTP_Token'::webknossos.CREDENTIAL_TYPE
      WHEN 'S3AccessKey'::webknossos.CREDENTIAL_TYPE_NEW THEN 'S3_Access_Key'::webknossos.CREDENTIAL_TYPE
      WHEN 'GoogleServiceAccount'::webknossos.CREDENTIAL_TYPE_NEW THEN 'GCS'::webknossos.CREDENTIAL_TYPE
    END;

DROP TYPE webknossos.CREDENTIAL_TYPE_NEW;

CREATE VIEW webknossos.credentials_ as SELECT * FROM webknossos.credentials WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation
SET schemaVersion = 98;

COMMIT TRANSACTION;
