### define
underscore : _
./task_type_model : TaskTypeModel
###

class TaskTypeCollection extends Backbone.Collection

  url : "/api/taskTypes"
  model : TaskTypeModel

  parse : (responses) ->

    return _.map(responses, TaskTypeModel::parse)


  addJSON : (item) ->

    [item] = @parse([item])
    @add(item)
