-- https://github.com/scalableminds/webknossos/pull/2427

-- Note: _organizationTeam needs to be the ID of the previous root team

START TRANSACTION;

CREATE TABLE webknossos.organizations(
  _id CHAR(24) PRIMARY KEY DEFAULT '',
  _organizationTeam CHAR(24) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  isDeleted BOOLEAN NOT NULL DEFAULT false
);

CREATE VIEW webknossos.organizations_ AS SELECT * FROM webknossos.organizations WHERE NOT isDeleted;

INSERT INTO webknossos.organizations(_id, _organizationTeam, name)
VALUES('5ab8b6be85000085008301c6', '5301a808ee7d7aab4053980f', 'Connectomics department');


DROP VIEW webknossos.teams_;
ALTER TABLE webknossos.teams ADD COLUMN _organization CHAR(24);
UPDATE webknossos.teams SET _organization = '5ab8b6be85000085008301c6';
ALTER TABLE webknossos.teams ALTER COLUMN _organization SET NOT NULL;
ALTER TABLE webknossos.teams DROP COLUMN _owner;
ALTER TABLE webknossos.teams DROP COLUMN _parent;
ALTER TABLE webknossos.teams DROP COLUMN behavesLikeRootTeam;
ALTER TABLE webknossos.teams DROP CONSTRAINT teams_name_key;
ALTER TABLE webknossos.teams ADD CONSTRAINT teams_name__organization_key UNIQUE(name, _organization);
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets ADD COLUMN _organization CHAR(24);
UPDATE webknossos.dataSets SET _organization = '5ab8b6be85000085008301c6';
ALTER TABLE webknossos.dataSets ALTER COLUMN _organization SET NOT NULL;
ALTER TABLE webknossos.dataSets DROP COLUMN _team CASCADE;
ALTER TABLE webknossos.dataSets DROP CONSTRAINT datasets_name__team_key;
ALTER TABLE webknossos.dataSets ADD CONSTRAINT datasets_name__organization_key UNIQUE(name, _organization);
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;


ALTER TABLE webknossos.user_team_roles ADD COLUMN isTeamManager BOOLEAN NOT NULL DEFAULT false;
UPDATE webknossos.user_team_roles SET isTeamManager = true where role = 'admin';
ALTER TABLE webknossos.user_team_roles DROP COLUMN role;


DROP VIEW webknossos.users_
ALTER TABLE webknossos.users ADD COLUMN isAdmin BOOLEAN NOT NULL DEFAULT false;
UPDATE webknossos.users SET isAdmin = true where _id in ('594bb2eb640000c8bd22f6bb');
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;
 -- TODO List all admins

DROP VIEW webknossos.users_;
ALTER TABLE webknossos.users ADD COLUMN _organization CHAR(24);
UPDATE webknossos.users SET _organization = '5ab8b6be85000085008301c6';
ALTER TABLE webknossos.users ALTER COLUMN _organization SET NOT NULL;



COMMIT TRANSACTION;
