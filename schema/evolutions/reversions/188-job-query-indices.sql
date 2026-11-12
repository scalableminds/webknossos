START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 188 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

CREATE INDEX ON webknossos.jobs(_worker);
DROP INDEX IF EXISTS webknossos.jobs__worker_manualstate_state_idx;
DROP INDEX IF EXISTS webknossos.jobs__owner_idx;

UPDATE webknossos.releaseInformation SET schemaVersion = 187;

COMMIT TRANSACTION;
