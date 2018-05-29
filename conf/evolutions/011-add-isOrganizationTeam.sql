-- https://github.com/scalableminds/webknossos/pull/2568

-- UP:


START TRANSACTION;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.teams ADD COLUMN isOrganizationTeam BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE webknossos.organizations DROP COLUMN _organizationTeam;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT TRANSACTION;


-- DOWN:


START TRANSACTION;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.teams DROP COLUMN isOrganizationTeam;
ALTER TABLE webknossos.organizations ADD COLUMN _organizationTeam CHAR(24);
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT TRANSACTION;
