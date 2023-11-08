START TRANSACTION;

ALTER TABLE webknossos.datasets DROP COLUMN IF EXISTS "isRemovedOnDisk";

UPDATE webknossos.releaseInformation SET schemaVersion = 109;

COMMIT TRANSACTION;
