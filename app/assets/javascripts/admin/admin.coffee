DatasetListView             = require("../dashboard/views/dataset/dataset_list_view")
PaginationView              = require("./views/pagination_view")
DatasetCollection           = require("./models/dataset/dataset_collection")
DatasetAddView              = require("./views/dataset/dataset_add_view")
UserListView                = require("./views/user/user_list_view")
UserCollection              = require("./models/user/user_collection")
TeamListView                = require("./views/team/team_list_view")
TeamCollection              = require("./models/team/team_collection")
TaskListView                = require("./views/task/task_list_view")
TaskCollection              = require("./models/task/task_collection")
TaskTypeListView            = require("./views/tasktype/task_type_list_view")
TaskTypeCollection          = require("./models/tasktype/task_type_collection")
ProjectListView             = require("./views/project/project_list_view")
ProjectCollection           = require("./models/project/project_collection")
StatisticView               = require("./views/statistic/statistic_view")
WorkloadListView            = require("./views/workload/workload_list_view")
WorkloadCollection          = require("./models/workload/workload_collection")

# ####
# This exports all the modules listed above and mainly the serves the purpose of
# waiting to be combinend and minified with rjs.
# ####

module.exports = {
  PaginationView
  DatasetCollection
  UserListView
  UserCollection
  TeamListView
  TeamCollection
  TaskListView
  TaskCollection
  TaskTypeCollection
  TaskTypeListView
  ProjectListView
  ProjectCollection
  StatisticView
  WorkloadListView
  WorkloadCollection
  DatasetAddView
}
