START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 174 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Reverse-join indices on team association tables (their primary keys lead with the non-_team column,
-- so _team-only access-control lookups could not use them).
CREATE INDEX ON webknossos.user_team_roles(_team);
CREATE INDEX ON webknossos.dataset_allowedTeams(_team);
CREATE INDEX ON webknossos.folder_allowedTeams(_team);
CREATE INDEX ON webknossos.annotation_sharedTeams(_team);

-- Folder path lookups by descendant (breadcrumb / read-access subqueries); PK leads with _ancestor.
CREATE INDEX ON webknossos.folder_paths(_descendant);

-- Job worker polling: composite index for reserveNextJob (seek the pending/dataStore slice, read in created order), plus per-worker lookups.
CREATE INDEX ON webknossos.jobs(state, _dataStore, created);
CREATE INDEX ON webknossos.jobs(_worker);

-- Credit transaction lookups by paid job and by organization.
CREATE INDEX ON webknossos.credit_transactions(_paid_job);
CREATE INDEX ON webknossos.credit_transactions(_organization);

UPDATE webknossos.releaseInformation SET schemaVersion = 175;

COMMIT TRANSACTION;
