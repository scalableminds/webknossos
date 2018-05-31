-- https://github.com/scalableminds/webknossos/pull/2568

-- UP:


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


-- DOWN:


START TRANSACTION;
DROP VIEW webknossos.teams_;
DROP VIEW webknossos.organizations_;
ALTER TABLE webknossos.organizations ADD COLUMN _organizationTeam CHAR(24);
UPDATE webknossos.organizations o SET _organizationTeam = (SELECT _id FROM webknossos.organizationTeams WHERE _organization = o._id);
DROP VIEW webknossos.organizationTeams;
ALTER TABLE webknossos.teams DROP COLUMN isOrganizationTeam;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;
CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;
COMMIT TRANSACTION;
