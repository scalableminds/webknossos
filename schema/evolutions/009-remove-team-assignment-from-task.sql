-- https://github.com/scalableminds/webknossos/pull/2553

-- removes the team assignment from the task. You can get the team via 'project'

START TRANSACTION;
DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks DROP COLUMN _team; -- automatically cascades to matching index
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;
CREATE INDEX tasks_neededexperience_domain_neededexperience_value_idx ON webknossos.tasks(neededExperience_domain, neededExperience_value);
COMMIT TRANSACTION;
