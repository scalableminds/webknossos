START TRANSACTION;

ALTER TABLE webknossos.datasets DROP COLUMN IF EXISTS "isRemovedOnDisk";

DROP VIEW webknossos.datasets_;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;


UPDATE webknossos.releaseInformation SET schemaVersion = 109;

COMMIT TRANSACTION;
