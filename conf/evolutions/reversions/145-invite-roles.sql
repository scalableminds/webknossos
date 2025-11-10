START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 145 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.invites_;

ALTER TABLE webknossos.invites DROP COLUMN isAdmin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webknossos.invites DROP COLUMN isOrganizationOwner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webknossos.invites DROP COLUMN isDatasetManager BOOLEAN NOT NULL DEFAULT FALSE;

CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;

DROP TABLE webknossos.invite_team_roles;

UPDATE webknossos.releaseInformation SET schemaVersion = 144;

COMMIT TRANSACTION;
