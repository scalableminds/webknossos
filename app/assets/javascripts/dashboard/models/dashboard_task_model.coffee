### define
underscore : _
backbone : Backbone
###

class DashboardTaskModel extends Backbone.Model

  parse : (annotation) ->
    # transform the annotation object which holds a task to a task object which holds its annotation

    task = annotation.task

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

    deferred = new $.Deferred()

    $.get(url).success( (response) =>

      @get("annotation").state.isFinished = true
      @trigger("change")
      deferred.resolve(response)

    ).fail( (xhr) ->
      deferred.reject(xhr.responseJSON)
    )

    return deferred.promise()
