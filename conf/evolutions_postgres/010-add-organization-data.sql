-- https://github.com/scalableminds/webknossos/pull/2635

-- UP:

BEGIN;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ADD COLUMN additionalInformation VARCHAR(2048) NOT NULL DEFAULT '';
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT;

-- DOWN:

BEGIN;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations DROP COLUMN additionalInformation;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT;
