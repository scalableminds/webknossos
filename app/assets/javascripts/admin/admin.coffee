### define
admin/views/pagination_view : PaginationView
admin/views/dataset/dataset_list_view : DatasetListView
admin/models/dataset/dataset_collection : DatasetCollection
admin/views/user/user_list_view : UserListView
admin/models/user/user_collection : UserCollection
admin/views/team/team_list_view : TeamListView
admin/models/team/team_collection : TeamCollection
admin/views/task/task_list_view : TaskListView
admin/models/task/task_collection : TaskCollection
admin/views/project/project_list_view : ProjectListView
admin/models/project/project_collection : ProjectCollection
###

# ####
# This exports all the modules listed above and mainly the serves the purpose of
# waiting to be combinend and minified with rjs.
# ####

return {
  PaginationView
  DatasetListView
  DatasetCollection
  UserListView
  UserCollection
  TeamListView
  TeamCollection
  TaskListView
  TaskCollection
  ProjectListView
  ProjectCollection
}

