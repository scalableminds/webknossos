START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 196 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.voxelytics_artifacts DROP COLUMN artifactsStoragePath;

UPDATE webknossos.releaseInformation SET schemaVersion = 195;

COMMIT TRANSACTION;
