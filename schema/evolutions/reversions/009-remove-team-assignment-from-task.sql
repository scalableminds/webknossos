START TRANSACTION;
DROP VIEW webknossos.tasks_;
ALTER TABLE webknossos.tasks ADD COLUMN _team CHAR(24);
UPDATE webknossos.tasks SET _team = (SELECT _team FROM webknossos.projects WHERE webknossos.tasks._project = webknossos.projects._id);
CREATE VIEW webknossos.tasks_ AS SELECT * FROM webknossos.tasks WHERE NOT isDeleted;

DROP INDEX webknossos.tasks_neededexperience_domain_neededexperience_value_idx;
CREATE INDEX ON webknossos.tasks(_team, neededExperience_domain, neededExperience_value);
COMMIT TRANSACTION;
