START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 167 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP VIEW webknossos.annotations_;

ALTER TABLE webknossos.annotations DROP COLUMN _team;

CREATE VIEW webknossos.annotations_ AS SELECT * FROM webknossos.annotations WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 168;

COMMIT TRANSACTION;
