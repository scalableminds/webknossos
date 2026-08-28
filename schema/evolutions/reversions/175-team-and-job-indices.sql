START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 175 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP INDEX IF EXISTS webknossos.user_team_roles__team_idx;
DROP INDEX IF EXISTS webknossos.dataset_allowedteams__team_idx;
DROP INDEX IF EXISTS webknossos.folder_allowedteams__team_idx;
DROP INDEX IF EXISTS webknossos.annotation_sharedteams__team_idx;
DROP INDEX IF EXISTS webknossos.folder_paths__descendant_idx;
DROP INDEX IF EXISTS webknossos.jobs_state__datastore_created_idx;
DROP INDEX IF EXISTS webknossos.jobs__worker_idx;
DROP INDEX IF EXISTS webknossos.credit_transactions__paid_job_idx;
DROP INDEX IF EXISTS webknossos.credit_transactions__organization_idx;

UPDATE webknossos.releaseInformation SET schemaVersion = 174;

COMMIT TRANSACTION;
