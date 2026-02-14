START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 153 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE TABLE webknossos.remote_paths_to_delete(
  path TEXT NOT NULL PRIMARY KEY,
  created TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE webknossos.releaseInformation SET schemaVersion = 154;

COMMIT TRANSACTION;
