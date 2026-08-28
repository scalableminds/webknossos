START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 117, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

ALTER TABLE "webknossos"."voxelytics_artifacts" ADD CONSTRAINT "voxelytics_artifacts__task_path_key" UNIQUE ("_task","path");

UPDATE webknossos.releaseInformation SET schemaVersion = 118;

COMMIT TRANSACTION;
