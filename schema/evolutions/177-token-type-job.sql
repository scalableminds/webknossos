START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 176 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TYPE webknossos.TOKEN_TYPES ADD VALUE IF NOT EXISTS 'Job';

-- Bearer token lookup by value: hit on every bearer-token-authenticated request.
CREATE INDEX ON webknossos.tokens(value);

-- Lookup by (loginInfo, tokenType): hit whenever a token is looked up/replaced for a user.
CREATE INDEX ON webknossos.tokens(loginInfo_providerID, loginInfo_providerKey, tokenType);

-- Speeds up the periodic hard-delete sweep of expired/soft-deleted tokens.
CREATE INDEX ON webknossos.tokens(expirationDateTime);

UPDATE webknossos.releaseInformation SET schemaVersion = 177;

COMMIT TRANSACTION;
