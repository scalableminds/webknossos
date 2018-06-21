-- https://github.com/scalableminds/webknossos/pull/2635

BEGIN;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ADD COLUMN additionalInformation VARCHAR(2048) NOT NULL DEFAULT '';
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT;
