START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 144 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.invites_;

ALTER TABLE webknossos.invites ADD COLUMN isAdmin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webknossos.invites ADD COLUMN isDatasetManager BOOLEAN NOT NULL DEFAULT FALSE;

CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;

CREATE TABLE webknossos.invite_team_roles(
  _invite TEXT CONSTRAINT _invite_objectId CHECK (_invite ~ '^[0-9a-f]{24}$') NOT NULL,
  _team TEXT CONSTRAINT _team_objectId CHECK (_team ~ '^[0-9a-f]{24}$') NOT NULL,
  isTeamManager BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (_invite, _team)
);

UPDATE webknossos.releaseInformation SET schemaVersion = 145;

COMMIT TRANSACTION;
