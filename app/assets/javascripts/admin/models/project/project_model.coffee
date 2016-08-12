_        = require("lodash")
backbone = require("backbone")

class ProjectModel extends Backbone.Model

  urlRoot : "/api/projects"
  idAttribute: "name"

  default :
    owner :
      firstName : ""
      lastName : ""
    priority: 100


  isNew : ->
    # Workaround. Since we use 'name' as the id attribute, there is no way to
    # know if a model was newly created or fetched from the server
    # Attribute is set in 'create_project_modal_view'
    return @_isNew or false


  parse : (response)->

    # set some sensible defaults
    response.owner ||= @default.owner
    return response


module.exports = ProjectModel
