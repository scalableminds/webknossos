Backbone = require("backbone")
FormatUtils = require("libs/format_utils")

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
    editRotation : [0, 0, 0]
    boundingBox : null
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
    isForAnonymous : false

  destroy : ->

    options = url : "/api/tasks/#{@get('id')}/delete"
    super(options)


module.exports = TaskModel
