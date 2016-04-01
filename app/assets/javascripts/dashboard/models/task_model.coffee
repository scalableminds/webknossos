_              = require("lodash")
NestedObjModel = require("libs/nested_obj_model")
Request        = require("libs/request")

class DashboardTaskModel extends NestedObjModel

  parse : (annotation) ->
    # transform the annotation object which holds a task to a task object which holds its annotation

    task = annotation.task

    return unless task

    unless task.type
      task.type = @defaultTaskType(annotation)

    task.annotation = annotation
    return task


  defaultTaskType : (annotation) ->

    summary : "[deleted] #{annotation.typ}"
    description : ""
    settings : { allowedModes : "" }


  finish : ->

    annotation = @get("annotation")
    url = "/annotations/#{annotation.typ}/#{annotation.id}/finish"

    return Request.receiveJSON(url).then(
      (response) =>
        @set("annotation.state.isFinished", true)
        return response
    )


module.exports = DashboardTaskModel
