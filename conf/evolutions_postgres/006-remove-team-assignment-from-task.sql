-- remove the team assignment from the task. You can get the team via 'project'

-- UP:


START TRANSACTION;
DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks DROP COLUMN _team;
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;

DROP INDEX webknossos.tasks__team_neededexperience_domain_neededexperience_value_idx;
CREATE INDEX tasks_neededexperience_domain_neededexperience_value_idx ON webknossos.tasks(neededExperience_domain, neededExperience_value);
COMMIT TRANSACTION;


-- DOWN:


START TRANSACTION;
DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks ADD COLUMN _team CHAR(24);
UPDATE webknossos.tasks SET _team = (SELECT _team FROM webknossos.projects WHERE webknossos.tasks._project = webknossos.projects._id)
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;

DROP INDEX webknossos.tasks_neededexperience_domain_neededexperience_value_idx;
CREATE INDEX ON webknossos.tasks(neededExperience_domain, neededExperience_value);
COMMIT TRANSACTION;
