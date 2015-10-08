_             = require("underscore")
TaskTypeModel = require("./task_type_model")

class TaskTypeCollection extends Backbone.Collection

  url : "/api/taskTypes"
  model : TaskTypeModel

  parse : (responses) ->

    return _.map(responses, TaskTypeModel::parse)


  addJSON : (item) ->

    [item] = @parse([item])
    @add(item)

module.exports = TaskTypeCollection
