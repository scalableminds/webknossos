START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 191 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.tokens_;
ALTER TABLE webknossos.tokens DROP COLUMN _oauthGrant;

DROP VIEW webknossos.oauthGrants_;
DROP TABLE webknossos.oauthTokens;
DROP TYPE webknossos.OAUTH_TOKEN_TYPES;
DROP TABLE webknossos.oauthAuthorizationCodes;
DROP TABLE webknossos.oauthGrants;
DROP TABLE webknossos.oauthClients;

-- Clear any rows using the new enum value before removing it
DELETE FROM webknossos.tokens WHERE tokenType = 'ShortLived';

-- Recreate the enum type without the new value by temporarily casting to text
ALTER TABLE webknossos.tokens ALTER COLUMN tokenType TYPE VARCHAR(255);
DROP TYPE webknossos.TOKEN_TYPES;
CREATE TYPE webknossos.TOKEN_TYPES AS ENUM ('Authentication', 'DataStore', 'ResetPassword', 'Job');
ALTER TABLE webknossos.tokens ALTER COLUMN tokenType TYPE webknossos.TOKEN_TYPES USING tokenType::webknossos.TOKEN_TYPES;
CREATE VIEW webknossos.tokens_ AS SELECT * FROM webknossos.tokens WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 190;

COMMIT TRANSACTION;
