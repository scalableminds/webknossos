START TRANSACTION;

ALTER TABLE webknossos.voxelytics_runs DROP CONSTRAINT IF EXISTS voxelytics_runs__organization_workflow_hash_fkey;
ALTER TABLE webknossos.voxelytics_runs DROP CONSTRAINT IF EXISTS voxelytics_runs__organization_fkey1;

ALTER TABLE webknossos.voxelytics_runs ADD CONSTRAINT voxelytics_runs__organization_workflow_hash_fkey FOREIGN KEY (_organization, workflow_hash) REFERENCES webknossos.voxelytics_workflows(_organization, hash) ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE;

UPDATE webknossos.releaseInformation SET schemaVersion = 95;

COMMIT TRANSACTION;
