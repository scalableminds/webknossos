-- https://github.com/scalableminds/webknossos/pull/2427

-- Note: _organizationTeam needs to be the ID of the previous root team

-- UP:

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
ALTER TABLE webknossos.dataSets DROP CONSTRAINT datasets_name__team_key;
ALTER TABLE webknossos.dataSets DROP COLUMN _team;
ALTER TABLE webknossos.dataSets ADD CONSTRAINT datasets_name__organization_key UNIQUE(name, _organization);
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;


ALTER TABLE webknossos.user_team_roles ADD COLUMN isTeamManager BOOLEAN NOT NULL DEFAULT false;
UPDATE webknossos.user_team_roles SET isTeamManager = true where role = 'admin';
ALTER TABLE webknossos.user_team_roles DROP COLUMN role;


DROP VIEW webknossos.users_;
ALTER TABLE webknossos.users ADD COLUMN isAdmin BOOLEAN NOT NULL DEFAULT false;
--hw + dr
UPDATE webknossos.users SET isAdmin = true where _id in ('594bb2eb640000c8bd22f6bb', '56125afe1500001923b47cf7');
--scalables
UPDATE webknossos.users SET isAdmin = true where _id in ('510eeaeee4b0d636137ffd27', '594bb2eb640000c8bd22f6bc', '594bb2eb640000c8bd22f6bb', '50be66b8e4b00d6764a0b22c', '50f2ab8de4b06378bd9a6637', '5a17e978660000af00bd5d48', '507067b1e4b064fc749a79e5', '520a5640e4b01945cedd8b74', '52a6515be4b06c5ea84a0b1b', '50b2a51ee4b0ceda50319438', '52ef32f8e4b0742580853857', '59663fac5a00009d8f43ddda');
ALTER TABLE webknossos.users ADD COLUMN _organization CHAR(24);
UPDATE webknossos.users SET _organization = '5ab8b6be85000085008301c6';
ALTER TABLE webknossos.users ALTER COLUMN _organization SET NOT NULL;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;



COMMIT TRANSACTION;




-- DOWN:

START TRANSACTION;

DROP VIEW webknossos.organizations_;
DROP TABLE webknossos.organizations;

DROP VIEW webknossos.teams_;
ALTER TABLE webknossos.teams DROP COLUMN _organization;
ALTER TABLE webknossos.teams ADD COLUMN _parent CHAR(24);
UPDATE webknossos.teams SET _parent = '5301a808ee7d7aab4053980f' WHERE NOT _id = '5301a808ee7d7aab4053980f';
ALTER TABLE webknossos.teams ADD COLUMN behavesLikeRootTeam BOOLEAN;
UPDATE webknossos.teams SET behavesLikeRootTeam = false WHERE _id != '5301a808ee7d7aab4053980f';
UPDATE webknossos.teams SET behavesLikeRootTeam = true WHERE _id = '5301a808ee7d7aab4053980f';
ALTER TABLE webknossos.teams ADD COLUMN _owner CHAR(24);
--set owner to hw. this is lossy since we drop the real owner info in the UP-evolution
UPDATE webknossos.teams SET _owner = '5447d5902d00001c35e1c965';
ALTER TABLE webknossos.teams ALTER COLUMN _owner SET NOT NULL;
CREATE VIEW webknossos.teams_ AS SELECT * FROM webknossos.teams WHERE NOT isDeleted;

DROP VIEW webknossos.dataSets_;
ALTER TABLE webknossos.dataSets DROP CONSTRAINT datasets_name__organization_key;
ALTER TABLE webknossos.dataSets DROP COLUMN _organization;
ALTER TABLE webknossos.dataSets ADD COLUMN _team CHAR(24);
UPDATE webknossos.dataSets SET _team = '5301a808ee7d7aab4053980f';
ALTER TABLE webknossos.dataSets ALTER COLUMN _team SET NOT NULL;
ALTER TABLE webknossos.dataSets ADD CONSTRAINT datasets_name__team_key UNIQUE (name, _team);
CREATE VIEW webknossos.dataSets_ AS SELECT * FROM webknossos.dataSets WHERE NOT isDeleted;

ALTER TABLE webknossos.user_team_roles ADD COLUMN role webknossos.TEAM_ROLES;
UPDATE webknossos.user_team_roles SET role = 'admin' where isTeamManager;
UPDATE webknossos.user_team_roles SET role = 'user' where not isTeamManager;
ALTER TABLE webknossos.user_team_roles ALTER COLUMN role SET NOT NULL;
ALTER TABLE webknossos.user_team_roles DROP COLUMN isTeamManager;

DROP VIEW webknossos.users_;
ALTER TABLE webknossos.users DROP COLUMN _organization;
ALTER TABLE webknossos.users DROP COLUMN isAdmin;
CREATE VIEW webknossos.users_ AS SELECT * FROM webknossos.users WHERE NOT isDeleted;


COMMIT TRANSACTION;
