START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 161 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.annotation_mutexes ADD COLUMN sessionId TEXT;
UPDATE webknossos.annotation_mutexes SET sessionId = _user;
ALTER TABLE webknossos.annotation_mutexes ALTER COLUMN sessionId SET NOT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 162;

COMMIT TRANSACTION;
