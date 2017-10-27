/**
 * admin.js
 * @flow weak
 */

import PaginationView from "admin/views/pagination_view";
import DatasetAddView from "admin/views/dataset/dataset_add_view";
import UserListView from "admin/views/user/user_list_view";
import UserCollection from "admin/models/user/user_collection";
import TeamListView from "admin/views/team/team_list_view";
import TeamCollection from "admin/models/team/team_collection";
import TaskListView from "admin/views/task/task_list_view";
import TaskCollection from "admin/models/task/task_collection";
import TaskTypeListView from "admin/views/tasktype/task_type_list_view";
import TaskTypeCollection from "admin/models/tasktype/task_type_collection";
import ProjectListView from "admin/views/project/project_list_view";
import ProjectCollection from "admin/models/project/project_collection";
import StatisticView from "admin/views/statistic/statistic_view";
import ScriptListView from "admin/views/scripts/script_list_view";
import ScriptCollection from "admin/models/scripts/script_collection";
import ProjectCreateView from "admin/views/project/project_create_view";
import ProjectModel from "admin/models/project/project_model";
import DatasetModel from "admin/models/dataset/dataset_model";
import TaskCreateView from "admin/views/task/task_create_view";
import TaskModel from "admin/models/task/task_model";
import TaskTypeCreateView from "admin/views/tasktype/task_type_create_view";
import TaskTypeModel from "admin/models/tasktype/task_type_model";
import ScriptCreateView from "admin/views/scripts/script_create_view";
import ScriptModel from "admin/models/scripts/script_model";

//
// This exports all the modules listed above and mainly serves the purpose of
// waiting to be combinend and minified with rjs.
//

export {
  PaginationView,
  UserListView,
  UserCollection,
  TeamListView,
  TeamCollection,
  TaskListView,
  TaskCollection,
  TaskTypeCollection,
  TaskTypeListView,
  ProjectListView,
  ProjectCollection,
  StatisticView,
  DatasetAddView,
  ScriptListView,
  ScriptCollection,
  ProjectCreateView,
  ProjectModel,
  DatasetModel,
  TaskCreateView,
  TaskModel,
  TaskTypeCreateView,
  TaskTypeModel,
  ScriptCreateView,
  ScriptModel,
};
