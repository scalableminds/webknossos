### define
underscore : _
backbone : Backbone
###

class DashboardModel extends Backbone.Model

  urlRoot : "/getDashboardInfoNew"

  defaults :
      showFinishedTasks : false
  #   dataSets : ""
  #   exploratory
  #   hasAnOpenTask
  #   loggedTime
  #   tasks
  #   user

  initialize : ->

    @listenTo(@, "sync", @transformToCollection)
    @listenTo(@, "change:showFinishedTasks", @filterTasks)



  filterTasks : ->

    if @get("showFinishedTasks")
      @set("filteredTasks", @get("tasks"))
    else
      filteredTasks = @get("tasks").filter( (task) -> !task.get("annotation").state.isFinished )
      @set( "filteredTasks", new Backbone.Collection(filteredTasks) )


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
    @filterTasks()

    exploratory = new Backbone.Collection(@get("exploratory"))
    @set("exploratory", exploratory)


