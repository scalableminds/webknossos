-- https://github.com/scalableminds/webknossos/pull/2462

START TRANSACTION;
DROP VIEW webknossos.datasets_;
ALTER TABLE webknossos.datasets ADD COLUMN displayName CHAR(256);
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;
COMMIT TRANSACTION;
