/**
 * admin.js
 * @flow weak
 */

import DatasetListView from "dashboard/views/dataset/dataset_list_view";
import PaginationView from "admin/views/pagination_view";
import DatasetCollection from "admin/models/dataset/dataset_collection";
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
import WorkloadListView from "admin/views/workload/workload_list_view";
import WorkloadCollection from "admin/models/workload/workload_collection";

//
// This exports all the modules listed above and mainly serves the purpose of
// waiting to be combinend and minified with rjs.
//

export {
  PaginationView,
  DatasetCollection,
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
  WorkloadListView,
  WorkloadCollection,
  DatasetAddView,
  DatasetListView,
};
