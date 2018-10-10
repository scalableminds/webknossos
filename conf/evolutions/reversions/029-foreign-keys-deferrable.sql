-- https://github.com/scalableminds/webknossos/pull/3328

START TRANSACTION;
ALTER TABLE webknossos.analytics
  DROP CONSTRAINT user_ref;
ALTER TABLE webknossos.annotations
  DROP CONSTRAINT task_ref,
  DROP CONSTRAINT team_ref,
  DROP CONSTRAINT user_ref;
ALTER TABLE webknossos.dataSets
  DROP CONSTRAINT organization_ref,
  DROP CONSTRAINT dataStore_ref;
ALTER TABLE webknossos.dataSet_layers
  DROP CONSTRAINT dataSet_ref;
ALTER TABLE webknossos.dataSet_allowedTeams
  DROP CONSTRAINT dataSet_ref,
  DROP CONSTRAINT team_ref;
ALTER TABLE webknossos.dataSet_resolutions
  DROP CONSTRAINT dataSet_ref;
ALTER TABLE webknossos.projects
  DROP CONSTRAINT team_ref,
  DROP CONSTRAINT user_ref;
ALTER TABLE webknossos.scripts
  DROP CONSTRAINT user_ref;
ALTER TABLE webknossos.taskTypes
  DROP CONSTRAINT team_ref;
ALTER TABLE webknossos.tasks
  DROP CONSTRAINT project_ref,
  DROP CONSTRAINT script_ref;
ALTER TABLE webknossos.teams
  DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.timespans
  DROP CONSTRAINT user_ref,
  DROP CONSTRAINT annotation_ref;
ALTER TABLE webknossos.users
  DROP CONSTRAINT organization_ref;
ALTER TABLE webknossos.user_team_roles
  DROP CONSTRAINT user_ref,
  DROP CONSTRAINT team_ref;
ALTER TABLE webknossos.user_experiences
  DROP CONSTRAINT user_ref;
ALTER TABLE webknossos.user_dataSetConfigurations
  DROP CONSTRAINT user_ref,
  DROP CONSTRAINT dataSet_ref;

ALTER TABLE webknossos.analytics
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id);
ALTER TABLE webknossos.annotations
  ADD CONSTRAINT task_ref FOREIGN KEY(_task) REFERENCES webknossos.tasks(_id) ON DELETE SET NULL,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id),
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id);
ALTER TABLE webknossos.dataSets
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id),
  ADD CONSTRAINT dataStore_ref FOREIGN KEY(_dataStore) REFERENCES webknossos.dataStores(name);
ALTER TABLE webknossos.dataSet_layers
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) ON DELETE CASCADE;
ALTER TABLE webknossos.dataSet_allowedTeams
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) ON DELETE CASCADE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE;
ALTER TABLE webknossos.dataSet_resolutions
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) ON DELETE CASCADE;
ALTER TABLE webknossos.projects
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id),
  ADD CONSTRAINT user_ref FOREIGN KEY(_owner) REFERENCES webknossos.users(_id);
ALTER TABLE webknossos.scripts
  ADD CONSTRAINT user_ref FOREIGN KEY(_owner) REFERENCES webknossos.users(_id);
ALTER TABLE webknossos.taskTypes
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE;
ALTER TABLE webknossos.tasks
  ADD CONSTRAINT project_ref FOREIGN KEY(_project) REFERENCES webknossos.projects(_id),
  ADD CONSTRAINT script_ref FOREIGN KEY(_script) REFERENCES webknossos.scripts(_id) ON DELETE SET NULL;
ALTER TABLE webknossos.teams
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id);
ALTER TABLE webknossos.timespans
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE,
  ADD CONSTRAINT annotation_ref FOREIGN KEY(_annotation) REFERENCES webknossos.annotations(_id) ON DELETE SET NULL;
ALTER TABLE webknossos.users
  ADD CONSTRAINT organization_ref FOREIGN KEY(_organization) REFERENCES webknossos.organizations(_id);
ALTER TABLE webknossos.user_team_roles
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE,
  ADD CONSTRAINT team_ref FOREIGN KEY(_team) REFERENCES webknossos.teams(_id) ON DELETE CASCADE;
ALTER TABLE webknossos.user_experiences
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE;
ALTER TABLE webknossos.user_dataSetConfigurations
  ADD CONSTRAINT user_ref FOREIGN KEY(_user) REFERENCES webknossos.users(_id) ON DELETE CASCADE,
  ADD CONSTRAINT dataSet_ref FOREIGN KEY(_dataSet) REFERENCES webknossos.dataSets(_id) ON DELETE CASCADE;
COMMIT TRANSACTION;
