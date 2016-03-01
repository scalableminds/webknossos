_                    = require("lodash")
PaginationCollection = require("../pagination_collection")
ProjectModel         = require("./project_model")

class ProjectCollection extends PaginationCollection

  model : ProjectModel
  url : "/api/projects"
  idAttribute : "name"
  sortBy : "name"

module.exports = ProjectCollection
