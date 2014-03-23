### define
underscore : _
backbone : Backbone
###

class DashboardTaskModel extends Backbone.Model

  urlRoot : "/getDashboardInfoNew"

  parse : (response) ->

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


  finish : ->

    annotation = @get("annotation")
    url = "/annotations/#{annotation.typ}/#{annotation.id}/finish"

    deferred = new $.Deferred()

    $.get(url).success( (response) =>

      @get("annotation").state.isFinished = true
      @trigger("change")
      deferred.resolve(response)

    ).fail( (xhr) ->
      deferred.reject(xhr.responseJSON)
    )

    return deferred.promise()
