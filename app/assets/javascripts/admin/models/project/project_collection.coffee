_                    = require("lodash")
Backbone             = require("backbone")
ProjectModel         = require("./project_model")

class ProjectCollection extends Backbone.Collection

  model : ProjectModel
  url : "/api/projects"
  idAttribute : "name"
  sortAttribute : "name"

module.exports = ProjectCollection
