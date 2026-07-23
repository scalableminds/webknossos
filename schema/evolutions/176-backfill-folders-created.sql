START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 175 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- parse created value from the timestamp encoded in the first 8 hex chars of the object id
UPDATE webknossos.folders
SET created = to_timestamp(('x' || substring(_id from 1 for 8))::bit(32)::bigint)
WHERE created IS NULL;

ALTER TABLE webknossos.folders ALTER COLUMN created SET NOT NULL;

UPDATE webknossos.releaseInformation SET schemaVersion = 176;

COMMIT TRANSACTION;
