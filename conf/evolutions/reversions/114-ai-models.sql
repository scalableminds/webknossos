START TRANSACTION;

do $$ begin ASSERT (select schemaVersion from webknossos.releaseInformation) = 114, 'Previous schema version mismatch'; end; $$ LANGUAGE plpgsql;

DROP VIEW webknossos.jobs_;
ALTER TABLE webknossos.jobs DROP COLUMN _voxelytics_workflowHash;
CREATE VIEW webknossos.jobs_ AS SELECT * FROM webknossos.jobs WHERE NOT isDeleted;

DROP TABLE webknossos.aiModel_trainingAnnotations;
DROP VIEW webknossos.aiModels_;
DROP VIEW webknossos.aiInferences_;

DROP TABLE webknossos.aiInferences;
DROP TABLE webknossos.aiModels;

DROP TYPE webknossos.AI_MODEL_CATEGORY;

UPDATE webknossos.releaseInformation SET schemaVersion = 113;

COMMIT TRANSACTION;
