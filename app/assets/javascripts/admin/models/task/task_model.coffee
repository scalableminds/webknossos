Backbone = require("backbone")
NestedObjModel = require("libs/nested_obj_model")
FormatUtils = require("libs/format_utils")

class TaskModel extends NestedObjModel

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
    created : FormatUtils.formatDate()
    status :
      open : 10
      inProgress : 0
      completed : 0
    tracingTime : null
    isForAnonymous : false


  destroy : ->

    options = url : "/api/tasks/#{@get('id')}"
    super(options)


module.exports = TaskModel
