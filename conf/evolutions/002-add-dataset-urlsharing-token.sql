-- https://github.com/scalableminds/webknossos/pull/2450

-- UP:


START TRANSACTION;
DROP VIEW webknossos.datasets_;
ALTER TABLE webknossos.datasets ADD COLUMN sharingToken CHAR(256);
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
COMMIT TRANSACTION;


-- DOWN:


START TRANSACTION;
DROP VIEW webknossos.datasets_;
ALTER TABLE webknossos.datasets DROP COLUMN sharingToken;
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
COMMIT TRANSACTION;
