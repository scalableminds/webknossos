BEGIN transaction;

UPDATE webknossos.releaseInformation SET schemaVersion = 91;

-- Delete OIDC users
DELETE FROM webknossos.multiUsers WHERE passwordInfo_hasher = 'Empty';
-- Enum is not altered (See evolution)

COMMIT;
