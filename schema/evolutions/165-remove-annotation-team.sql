START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 164 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.annotations DROP COLUMN _team;

UPDATE webknossos.releaseInformation SET schemaVersion = 165;

COMMIT TRANSACTION;
