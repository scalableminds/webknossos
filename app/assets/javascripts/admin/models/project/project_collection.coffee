### define
underscore : _
../pagination_collection : PaginationCollection
./project_model : ProjectModel
###

class ProjectCollection extends PaginationCollection

  model : ProjectModel
  url : "/api/projects"
  idAttribute : "name"

