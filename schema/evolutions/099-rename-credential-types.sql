START TRANSACTION;

DROP VIEW webknossos.credentials_;

ALTER TYPE webknossos.CREDENTIAL_TYPE RENAME TO CREDENTIAL_TYPE_OLD;
CREATE TYPE webknossos.CREDENTIAL_TYPE AS ENUM ('HttpBasicAuth', 'HttpToken', 'S3AccessKey', 'GoogleServiceAccount');

ALTER TABLE webknossos.credentials
	ALTER COLUMN type TYPE webknossos.CREDENTIAL_TYPE USING
    CASE type
      WHEN 'HTTP_Basic_Auth'::webknossos.CREDENTIAL_TYPE_OLD THEN 'HttpBasicAuth'::webknossos.CREDENTIAL_TYPE
      WHEN 'HTTP_Token'::webknossos.CREDENTIAL_TYPE_OLD THEN 'HttpToken'::webknossos.CREDENTIAL_TYPE
      WHEN 'S3_Access_Key'::webknossos.CREDENTIAL_TYPE_OLD THEN 'S3AccessKey'::webknossos.CREDENTIAL_TYPE
      WHEN 'GCS'::webknossos.CREDENTIAL_TYPE_OLD THEN 'GoogleServiceAccount'::webknossos.CREDENTIAL_TYPE
    END;

DROP TYPE webknossos.CREDENTIAL_TYPE_OLD;

CREATE VIEW webknossos.credentials_ as SELECT * FROM webknossos.credentials WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation
SET schemaVersion = 99;

COMMIT TRANSACTION;
