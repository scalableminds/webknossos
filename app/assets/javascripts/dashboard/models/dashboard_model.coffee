### define
underscore : _
backbone : Backbone
###

class DashboardModel extends Backbone.Model

  urlRoot : "/getDashboardInfoNew"

  # defaults :
  #   dataSets : ""
  #   exploratory
  #   hasAnOpenTask
  #   loggedTime
  #   tasks
  #   user

  initialize : ->

    @listenTo(@, "sync", @transformToCollection)


  transformToCollection : ->

    tasks = new Backbone.Collection(@get("tasks"))

    defaultTaskType = (annotation) ->

      summary : "[deleted] " + annotation.typ
      description : ""
      settings : { allowedModes : "" }


    for taskAnnotationTuple in tasks.models

      task = taskAnnotationTuple.get("tasks")

      unless task.type
        task.type = defaultTaskType(taskAnnotationTuple.get("annotation"))

    @set("tasks", tasks)

    exploratory = new Backbone.Collection(@get("exploratory"))
    @set("exploratory", exploratory)


