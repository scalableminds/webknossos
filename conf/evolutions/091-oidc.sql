BEGIN transaction;

ALTER TYPE webknossos.USER_PASSWORDINFO_HASHERS ADD VALUE 'Empty';
UPDATE webknossos.releaseInformation SET schemaVersion = 91;

COMMIT;
