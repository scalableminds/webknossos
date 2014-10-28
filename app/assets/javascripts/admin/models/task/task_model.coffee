### define
format_utils : FormatUtils
###

class TaskModel extends Backbone.Model

  idAttribute : "_id.$oid"

  # TODO : build backend for
  # GET/ POST/ PUT/ DELETE
  url : -> "/api/tasks/#{@get('id')}"

  parse : (response) ->

    # response.formattedHash = FormatUtils.formatHash(response.id)
    # response.formattedShortText = FormatUtils.formatShortText(response.summary)

    return response

  defaults :
    priority : 100
    instances : 10
    _project : ""
    team : ""
    _taskType :
      $oid : null
    neededExperience :
      value : 0
      domain : ""
    start :
      point : "0, 0, 0"
    boundingBox :
      box : "0, 0, 0, 0, 0, 0"


  destroy : ->

    options = url : "/api/tasks/#{@get('id')}/delete"
    super(options)
