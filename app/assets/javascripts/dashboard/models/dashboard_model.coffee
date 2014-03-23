### define
underscore : _
backbone : Backbone
./dashboard_task_model : DashboardTaskModel
###

class DashboardModel extends Backbone.Model

  urlRoot : "/getDashboardInfoNew"

  defaults :
      showFinishedTasks : false

  initialize : ->

    @listenTo(@, "sync", @transformToCollection)


  getFinishedTasks : ->

    return @get("tasks")


  getUnfinishedTasks : ->

    filteredTasks = @get("tasks").filter( (task) -> return !task.get("annotation").state.isFinished )
    return new Backbone.Collection(filteredTasks)


  transformToCollection : ->

    tasks = @get("tasksWithAnnotations").map( (el) ->

      return DashboardTaskModel::parse(el)
    )

    tasks = new Backbone.Collection(tasks, model : DashboardTaskModel )
    @set("tasks", tasks)

    exploratory = new Backbone.Collection(@get("exploratory"))
    @set("exploratory", exploratory)



