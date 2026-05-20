START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 162 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

ALTER TABLE webknossos.aiModels DROP CONSTRAINT _user_objectId;
ALTER TABLE webknossos.aiModels ALTER COLUMN _user DROP NOT NULL;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');

UPDATE webknossos.aiModels SET _user = NULL WHERE isPretrained;

UPDATE webknossos.releaseInformation SET schemaVersion = 163;

COMMIT TRANSACTION;
