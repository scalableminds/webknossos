START TRANSACTION;

do $$ begin if (select schemaVersion from webknossos.releaseInformation) <> 162 then raise exception 'Previous schema version mismatch'; end if; end; $$ language plpgsql;

-- Remove pretrained models that have no user (they will be re-inserted by InitialDataController after rollback)
DELETE FROM webknossos.aiModels WHERE isPretrainedModel = TRUE;

ALTER TABLE webknossos.aiModels DROP CONSTRAINT _user_objectId;
ALTER TABLE webknossos.aiModels ALTER COLUMN _user SET NOT NULL;
ALTER TABLE webknossos.aiModels ADD CONSTRAINT _user_objectId CHECK (_user ~ '^[0-9a-f]{24}$');

UPDATE webknossos.releaseInformation SET schemaVersion = 161;

COMMIT TRANSACTION;
