-- https://github.com/scalableminds/webknossos/pull/5334

START TRANSACTION;

DROP VIEW webknossos.taskTypes_;
DROP VIEW webknossos.projects_;

ALTER TABLE webknossos.taskTypes ADD COLUMN _organization CHAR(24);
ALTER TABLE webknossos.projects ADD COLUMN _organization CHAR(24);

ALTER TABLE webknossos.taskTypes DROP CONSTRAINT tasktypes_summary_key;

UPDATE webknossos.projects set _organization = (select _organization from webknossos.users where _id = _owner);
UPDATE webknossos.tasktypes set _organization = (select _organization from webknossos.teams where _id = _team);

ALTER TABLE webknossos.projects ALTER COLUMN _organization SET NOT NULL;
ALTER TABLE webknossos.tasktypes ALTER COLUMN _organization SET NOT NULL;

ALTER TABLE webknossos.taskTypes ADD CONSTRAINT tasktypes_summary__organization_key UNIQUE(summary, _organization);
ALTER TABLE webknossos.projects ADD CONSTRAINT projects_name__organization_key UNIQUE(name, _organization);

CREATE VIEW webknossos.projects_ AS SELECT * FROM webknossos.projects WHERE NOT isDeleted;
CREATE VIEW webknossos.taskTypes_ AS SELECT * FROM webknossos.taskTypes WHERE NOT isDeleted;

UPDATE webknossos.releaseInformation SET schemaVersion = 68;

COMMIT TRANSACTION;
