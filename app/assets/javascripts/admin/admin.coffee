PaginationView              = require("./views/pagination_view")
DatasetListView             = require("../dashboard/views/dataset/dataset_list_view")
DatasetCollection           = require("./models/dataset/dataset_collection")
PaginatedDatasetCollection  = require("./models/dataset/paginated_dataset_collection")
DatasetAddView              = require("./views/dataset/dataset_add_view")
UserListView                = require("./views/user/user_list_view")
UserCollection              = require("./models/user/user_collection")
TeamListView                = require("./views/team/team_list_view")
TeamCollection              = require("./models/team/team_collection")
PaginatedTeamCollection     = require("./models/team/paginated_team_collection")
TaskListView                = require("./views/task/task_list_view")
TaskCollection              = require("./models/task/task_collection")
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
  PaginatedDatasetCollection
  PaginatedTeamCollection
  UserListView
  UserCollection
  TeamListView
  TeamCollection
  TaskListView
  TaskCollection
  ProjectListView
  ProjectCollection
  StatisticView
  WorkloadListView
  WorkloadCollection
  DatasetAddView
}
