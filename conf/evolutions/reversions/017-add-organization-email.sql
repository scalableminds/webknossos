START TRANSACTION;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations DROP COLUMN newUserMailingList;
ALTER TABLE webknossos.organizations DROP COLUMN overTimeMailingList;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT TRANSACTION;
