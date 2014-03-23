### define
underscore : _
backbone : Backbone
###

class DashboardTaskModel extends Backbone.Model

  urlRoot : "/getDashboardInfoNew"

  parse : (response) ->

    console.log "parse", response
    defaultTaskType = (annotation) ->

      summary : "[deleted] " + annotation.typ
      description : ""
      settings : { allowedModes : "" }

    task = response.task

    unless task.type
      task.type = defaultTaskType(response.annotation)

    # transform the task-annotation-object to a task which holds its annotation as an attribute
    task.annotation = response.annotation
    return task
