-- https://github.com/scalableminds/webknossos/pull/2568

START TRANSACTION;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.teams ADD COLUMN isOrganizationTeam BOOLEAN NOT NULL DEFAULT false;
UPDATE webknossos.teams SET isOrganizationTeam = true WHERE _id in (SELECT _organizationTeam FROM webknossos.organizations);
ALTER TABLE webknossos.organizations DROP COLUMN _organizationTeam;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
CREATE VIEW webknossos.organizationTeams AS SELECT * FROM webknossos.teams WHERE isOrganizationTeam AND NOT isDeleted;
COMMIT TRANSACTION;
