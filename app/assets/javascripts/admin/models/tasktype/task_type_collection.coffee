_                = require("lodash")
TaskTypeModel    = require("./task_type_model")
SortedCollection = require("../sorted_collection")

class TaskTypeCollection extends SortedCollection

  url : "/api/taskTypes"
  model : TaskTypeModel
  sortAttribute : "summary"

  parse : (responses) ->

    return _.map(responses, TaskTypeModel::parse)


  addJSON : (item) ->

    [item] = @parse([item])
    @add(item)

module.exports = TaskTypeCollection
