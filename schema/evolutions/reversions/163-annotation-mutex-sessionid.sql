START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 163 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.annotation_mutexes DROP COLUMN sessionId;

UPDATE webknossos.releaseInformation SET schemaVersion = 162;

COMMIT TRANSACTION;
