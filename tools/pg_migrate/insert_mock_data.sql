
insert into webknossos.annotations(_id, _dataSet, _team, _user, tracing_id, tracing_typ, state, statistics, typ)
  values('596792e65d0000d304d77160', '596792e65d0000d304d77165', '596792e65d0000d304d77164', '596792e65d0000d304d77166', 'ebeb2bc2-db28-48bf-a0c4-ea4cbd37a655', 'skeleton', 'Active', '{}', 'Explorational');

insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, tracing_id, tracing_typ, state, statistics, typ)
  values('596792e65d0000d304d77161', '596792e65d0000d304d77165', '596792e65d0000d304d77163', '596792e65d0000d304d77164', '596792e65d0000d304d77166', 'ebeb2bc2-db28-48bf-a0c4-ea4cbd37a655', 'skeleton', 'Active', '{}', 'Task');

insert into webknossos.taskTypes(_id, _team, summary, description, settings_branchPointsAllowed, settings_somaClickingAllowed)
  values('596792e65d0000d304d77162', '596792e65d0000d304d77164', 'taskType_summary', 'taskType_description', false, false);

insert into webknossos.tasks(_id, _project, _taskType, _team, neededExperience_domain, neededExperience_value, totalInstances, tracingTime, editPosition, editRotation)
  values('596792e65d0000d304d77163', '596792e65d0000d304d77167', '596792e65d0000d304d77162', '596792e65d0000d304d77164', 'experience_domain', 1, 10, 0, '(0,0,0)', '(0,0,0)');

insert into webknossos.teams(_id, _owner, name, behavesLikeRootTeam)
  values('596792e65d0000d304d77164', '596792e65d0000d304d77166', 'Connectomics department', false);

insert into webknossos.dataSets(_id, _dataStore, _team, name)
  values('596792e65d0000d304d77165', 'dataStore_id', '596792e65d0000d304d77164', 'ROI2017_wkw');

insert into webknossos.users(_id, email, firstName, lastName, userConfiguration, dataSetConfigurations, loginInfo_providerKey, passwordInfo_password)
  values('596792e65d0000d304d77166', 'scmboy@scalableminds.com', 'SCM', 'Boy', '{"configuration" : {}}', '{}', 'providerKey', 'passwordhash');

insert into webknossos.projects(_id, _team, _owner, name)
  values('596792e65d0000d304d77167', '596792e65d0000d304d77164', '596792e65d0000d304d77166', 'project_name')
