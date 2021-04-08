START TRANSACTION;

DROP VIEW webknossos.taskTypes_;
DROP VIEW webknossos.projects_;

ALTER TABLE webknossos.taskTypes DROP CONSTRAINT tasktypes_summary__organization_key;
ALTER TABLE webknossos.projects DROP CONSTRAINT projects_name__organization_key;

ALTER TABLE webknossos.projects DROP COLUMN _organization;
ALTER TABLE webknossos.tasktypes DROP COLUMN _organization;

ALTER TABLE webknossos.taskTypes ADD CONSTRAINT tasktypes_summary_key UNIQUE(summary);

CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 68;

COMMIT TRANSACTION;
