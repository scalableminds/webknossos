START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 187 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Job list: fetch the jobs of the requesting user / of their organization’s users instead of scanning all jobs.
CREATE INDEX ON webknossos.jobs(_owner);

-- Job worker polling: serves the per-worker unfinished/cancelling lookups and the unassigned-pending counts
-- (_worker IS NULL) with all predicates as index conditions. Supersedes the plain _worker index.
CREATE INDEX ON webknossos.jobs(_worker, manualState, state);
DROP INDEX IF EXISTS webknossos.jobs__worker_idx;

UPDATE webknossos.releaseInformation SET schemaVersion = 188;

COMMIT TRANSACTION;
