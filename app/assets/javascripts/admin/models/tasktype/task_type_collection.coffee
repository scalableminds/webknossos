### define
underscore : _
format_utils : FormatUtils
./task_type_model : TaskTypeModel
###

class TaskTypeCollection extends Backbone.Collection

  url : "/api/taskTypes"
  model : TaskTypeModel


  parse : (responses) ->

    _.map(responses, (response) ->
      response.formattedHash = FormatUtils.formatHash(response.id)
      response.formattedShortText = FormatUtils.formatShortText(response.summary)

      return response
    )
