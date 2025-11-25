START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 146 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.invites_;

ALTER TABLE webknossos.invites DROP COLUMN isAdmin;
ALTER TABLE webknossos.invites DROP COLUMN isDatasetManager;

CREATE VIEW webknossos.invites_ AS SELECT * FROM webknossos.invites WHERE NOT isDeleted;

DROP TABLE webknossos.invite_team_roles;

UPDATE webknossos.releaseInformation SET schemaVersion = 145;

COMMIT TRANSACTION;
