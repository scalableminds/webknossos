-- remove the team assignment from the task. You can get the team via 'project'

-- UP:


START TRANSACTION;
DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks DROP COLUMN _team;
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;
COMMIT TRANSACTION;


-- DOWN:


START TRANSACTION;
DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks ADD COLUMN _team CHAR(255); -- which data type is 'team'?
UPDATE webknossos.tasks SET _team = (SELECT _team FROM webknossos.projects WHERE webknossos.tasks._team = webknossos.projects._team)
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;
COMMIT TRANSACTION;
