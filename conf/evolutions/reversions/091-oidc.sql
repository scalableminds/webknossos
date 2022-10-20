BEGIN transaction;

UPDATE webknossos.releaseInformation SET schemaVersion = 90;
DROP VIEW webknossos.multiUsers_;

-- Delete OIDC users
DELETE FROM webknossos.multiUsers WHERE passwordInfo_hasher = 'Empty';

-- Remove option from enum (requires creating a new type)
CREATE TYPE webknossos.USER_PASSWORDINFO_HASHERS_INITIAL AS ENUM ('Scrypt');

ALTER TABLE webknossos.multiUsers
  ALTER COLUMN passwordInfo_hasher TYPE webknossos.USER_PASSWORDINFO_HASHERS_INITIAL
    USING (passwordInfo_hasher::text::webknossos.USER_PASSWORDINFO_HASHERS_INITIAL);

DROP TYPE IF EXISTS webknossos.USER_PASSWORDINFO_HASHERS;

ALTER TYPE webknossos.USER_PASSWORDINFO_HASHERS_INITIAL RENAME TO "webknossos.USER_PASSWORDINFO_HASHERS";
CREATE VIEW webknossos.multiUsers_ AS SELECT * FROM webknossos.multiUsers WHERE NOT isDeleted;
COMMIT;
