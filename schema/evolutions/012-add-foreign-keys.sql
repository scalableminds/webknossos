-- https://github.com/scalableminds/webknossos/pull/2568

-- Possible manual work:
   -- delete annotations with state = Initializing   https://github.com/scalableminds/webknossos/issues/2703
   -- delete timespans with task ids as annotation IDs    https://github.com/scalableminds/webknossos/issues/2702

START TRANSACTION;
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
