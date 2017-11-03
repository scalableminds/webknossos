/**
 * admin.js
 * @flow weak
 */

import DatasetAddView from "admin/views/dataset/dataset_add_view";
import UserListView from "admin/views/user/user_list_view";
import TeamListView from "admin/views/team/team_list_view";
import TaskListView from "admin/views/task/task_list_view";
import TaskTypeListView from "admin/views/tasktype/task_type_list_view";
import ProjectListView from "admin/views/project/project_list_view";
import StatisticView from "admin/views/statistic/statistic_view";
import ScriptListView from "admin/views/scripts/script_list_view";
import ProjectCreateView from "admin/views/project/project_create_view";
import TaskCreateView from "admin/views/task/task_create_view";
import TaskTypeCreateView from "admin/views/tasktype/task_type_create_view";
import ScriptCreateView from "admin/views/scripts/script_create_view";
import TaskCreateFormView from "admin/views/task/task_create_form_view";

//
// This exports all the modules listed above and mainly serves the purpose of
// waiting to be combinend and minified with rjs.
//

export {
  UserListView,
  TeamListView,
  TaskListView,
  TaskTypeListView,
  ProjectListView,
  StatisticView,
  DatasetAddView,
  ScriptListView,
  ProjectCreateView,
  TaskCreateView,
  TaskTypeCreateView,
  ScriptCreateView,
  TaskCreateFormView,
};
