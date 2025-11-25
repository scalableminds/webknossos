START TRANSACTION;

DROP VIEW webknossos.organizations_;

ALTER TABLE webknossos.organizations DROP COLUMN enableAutoVerify;

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 39;

COMMIT TRANSACTION;
