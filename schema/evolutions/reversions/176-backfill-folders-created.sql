START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 176 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.folders ALTER COLUMN created DROP NOT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 175;

COMMIT TRANSACTION;
