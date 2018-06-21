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

CREATE TYPE webknossos.TEAM_ROLES AS ENUM ('user', 'admin');
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
