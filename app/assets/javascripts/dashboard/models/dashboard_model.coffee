### define
underscore : _
backbone : Backbone
./dashboard_task_model : DashboardTaskModel
./user_model : UserModel
###

class DashboardModel extends Backbone.Model

  urlRoot : ->

    if userID = @get("userID")
      return "/api/users/#{userID}/annotations"
    else
      return "/api/user/annotations"


  newTaskUrl : "/user/tasks/request"
  defaults :
      showFinishedTasks : false

  initialize : (options) ->

    @listenTo(@, "sync", @transformToCollection)


  fetch : ->

    promiseA = super(arguments)

    user = new UserModel(id : @get("userID"))
    @set("user", user)

    promiseB = user.fetch()

    return $.when(promiseA, promiseB)


  getFinishedTasks : ->

    return @get("tasks")


  getUnfinishedTasks : ->

    filteredTasks = @get("tasks").filter( (task) -> return !task.get("annotation").state.isFinished )
    return new Backbone.Collection(filteredTasks)


  transformToCollection : ->

    tasks = @get("taskAnnotations").map( (el) ->
      return DashboardTaskModel::parse(el)
    )

    tasks = new Backbone.Collection(tasks, model : DashboardTaskModel )
    @set("tasks", tasks)

    exploratoryAnnotations = new Backbone.Collection(@get("exploratoryAnnotations"))
    @set("exploratoryAnnotations", exploratoryAnnotations)


  getNewTask : ->

    newTask = new DashboardTaskModel()

    return newTask.fetch(
      url : @newTaskUrl
      success : (response) =>
        @get("tasks").add(newTask)
    )

