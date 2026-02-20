START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 151 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_mags DROP COLUMN uploadToPathIsPending;

UPDATE webknossos.releaseInformation SET schemaVersion = 150;

COMMIT TRANSACTION;
