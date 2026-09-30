START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 185 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.dataset_lastUsedTimes DROP CONSTRAINT dataset_lastUsedTimes_pkey;

UPDATE webknossos.releaseInformation SET schemaVersion = 184;

COMMIT TRANSACTION;
