START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 182 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

DROP INDEX webknossos.annotations__dataset_idx;
DROP INDEX webknossos.annotation_contributors__user_idx;

UPDATE webknossos.releaseInformation SET schemaVersion = 181;

COMMIT TRANSACTION;
