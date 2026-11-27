START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 195 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.voxelytics_artifacts ADD COLUMN artifactsStoragePath TEXT;

UPDATE webknossos.releaseInformation SET schemaVersion = 196;

COMMIT TRANSACTION;
