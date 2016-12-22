import DatasetListView from "../dashboard/views/dataset/dataset_list_view";
import PaginationView from "./views/pagination_view";
import DatasetCollection from "./models/dataset/dataset_collection";
import DatasetAddView from "./views/dataset/dataset_add_view";
import UserListView from "./views/user/user_list_view";
import UserCollection from "./models/user/user_collection";
import TeamListView from "./views/team/team_list_view";
import TeamCollection from "./models/team/team_collection";
import TaskListView from "./views/task/task_list_view";
import TaskCollection from "./models/task/task_collection";
import TaskTypeListView from "./views/tasktype/task_type_list_view";
import TaskTypeCollection from "./models/tasktype/task_type_collection";
import ProjectListView from "./views/project/project_list_view";
import ProjectCollection from "./models/project/project_collection";
import StatisticView from "./views/statistic/statistic_view";
import WorkloadListView from "./views/workload/workload_list_view";
import WorkloadCollection from "./models/workload/workload_collection";

// ####
// This exports all the modules listed above and mainly the serves the purpose of
// waiting to be combinend and minified with rjs.
// ####

export { PaginationView, DatasetCollection, UserListView, UserCollection, TeamListView, TeamCollection, TaskListView, TaskCollection, TaskTypeCollection, TaskTypeListView, ProjectListView, ProjectCollection, StatisticView, WorkloadListView, WorkloadCollection, DatasetAddView };
