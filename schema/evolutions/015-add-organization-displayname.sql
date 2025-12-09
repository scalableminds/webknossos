-- https://github.com/scalableminds/webknossos/pull/2869

START TRANSACTION;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ADD COLUMN displayName VARCHAR(1024) NOT NULL DEFAULT '';
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
UPDATE webknossos.organizations SET displayName = name;
COMMIT TRANSACTION;
