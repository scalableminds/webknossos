-- https://github.com/scalableminds/webknossos/pull/2939


START TRANSACTION;

DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ADD COLUMN newUserMailingList VARCHAR(512) NOT NULL DEFAULT '';
ALTER TABLE webknossos.organizations ADD COLUMN overTimeMailingList VARCHAR(512) NOT NULL DEFAULT '';
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation set schemaVersion = 17;

COMMIT TRANSACTION;
