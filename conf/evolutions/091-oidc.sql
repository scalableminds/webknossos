BEGIN transaction;

-- Cannot alter enum in transaction block, workaround required

ALTER TABLE webknossos.multiusers ALTER COLUMN passwordInfo_hasher TYPE VARCHAR(255);
DROP TYPE IF EXISTS webknossos.USER_PASSWORDINFO_HASHERS;
CREATE TYPE webknossos.USER_PASSWORDINFO_HASHERS AS ENUM (
  'SCrypt',
  'Empty'
  );
ALTER TABLE webknossos.multiusers
  ALTER COLUMN passwordInfo_hasher TYPE webknossos.USER_PASSWORDINFO_HASHERS
    USING (passwordInfo_hasher::webknossos.USER_PASSWORDINFO_HASHERS);

UPDATE webknossos.releaseInformation SET schemaVersion = 91;

COMMIT;
