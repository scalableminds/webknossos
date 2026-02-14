START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 154 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP TABLE webknossos.remote_paths_to_delete;

UPDATE webknossos.releaseInformation SET schemaVersion = 153;

COMMIT TRANSACTION;
