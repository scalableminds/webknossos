START TRANSACTION;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations DROP COLUMN displayName;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT TRANSACTION;
