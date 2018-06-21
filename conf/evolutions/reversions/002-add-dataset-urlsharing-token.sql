START TRANSACTION;
DROP VIEW webknossos.datasets_;
ALTER TABLE webknossos.datasets DROP COLUMN sharingToken;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
COMMIT TRANSACTION;
