START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 149 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_mags ADD COLUMN uploadToPathIsPending BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE webknossos.releaseInformation SET schemaVersion = 150;

COMMIT TRANSACTION;
