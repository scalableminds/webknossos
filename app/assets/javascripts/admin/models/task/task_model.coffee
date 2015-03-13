### define
format_utils : FormatUtils
###

class TaskModel extends Backbone.Model

  url : ->
    id = ''
    if @get('id')?
      id = '/' + @get('id')
    return "/api/tasks#{id}"

  defaults :
    team : ""
    formattedHash : ""
    projectName : ""
    type : null
    dataSet : ""
    editPosition : [0, 0, 0]
    boundingBox :
      topLeft: [0,0,0]
      width: 0
      height: 0
      depth: 0
    neededExperience :
      value : 0
      domain : ""
    priority : 100
    created : FormatUtils.formatDate()
    status :
      open : 10
      inProgress : 0
      completed : 0
    tracingTime : null

  destroy : ->

    options = url : "/api/tasks/#{@get('id')}/delete"
    super(options)
