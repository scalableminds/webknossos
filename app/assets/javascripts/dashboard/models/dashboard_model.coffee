### define
underscore : _
backbone : Backbone
./dashboard_task_model : DashboardTaskModel
###

class DashboardModel extends Backbone.Model

  urlRoot : ->

    if userID = @get("userID")
      return "/api/users/#{userID}/details"
    else
      return "/api/user/details"


  newTaskUrl : "/user/tasks/request"
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


  getNewTask : ->

    deferred = new $.Deferred()
    newTask = new DashboardTaskModel()
    newTask.fetch(
      url : @newTaskUrl
      success : (response) =>
        @get("tasks").add(newTask)
        deferred.resolve(response)
      error : (model, xhr) ->
        deferred.reject(xhr.responseJSON)
    )
    return deferred
