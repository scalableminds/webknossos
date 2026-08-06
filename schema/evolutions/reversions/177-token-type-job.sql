START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 177 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP INDEX IF EXISTS webknossos.tokens_value_idx;
DROP INDEX IF EXISTS webknossos.tokens_logininfo_providerid_logininfo_providerkey_tokentype_idx;
DROP INDEX IF EXISTS webknossos.tokens_expirationdatetime_idx;

-- Clear any rows using the new enum value before removing it
DELETE FROM webknossos.tokens WHERE tokenType = 'Job';

-- Recreate the enum type without the new value by temporarily casting to text
ALTER TABLE webknossos.tokens ALTER COLUMN tokenType TYPE VARCHAR(255);
DROP TYPE webknossos.TOKEN_TYPES;
CREATE TYPE webknossos.TOKEN_TYPES AS ENUM ('Authentication', 'DataStore', 'ResetPassword');
ALTER TABLE webknossos.tokens ALTER COLUMN tokenType TYPE webknossos.TOKEN_TYPES USING tokenType::webknossos.TOKEN_TYPES;

UPDATE webknossos.releaseInformation SET schemaVersion = 176;

COMMIT TRANSACTION;
