START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 118, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE "webknossos"."voxelytics_artifacts" DROP CONSTRAINT "voxelytics_artifacts__task_path_key";

UPDATE webknossos.releaseInformation SET schemaVersion = 117;

COMMIT TRANSACTION;
