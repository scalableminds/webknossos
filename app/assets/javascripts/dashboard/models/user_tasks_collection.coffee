### define
underscore : _
backbone : Backbone
./task_model : TaskModel
###

class UserTasksCollection extends Backbone.Collection

  model : TaskModel
  url : ->

    if userID = @get("userID")
      return "/api/users/#{userID}/tasks"
    else
      return "/api/user/tasks"


  newTaskUrl : "/user/tasks/request"
  defaults :
      showFinishedTasks : false

  initialize : (options) ->

    @listenTo(@, "sync", @transformToCollection)


  parse : (response) ->

    @hasSynced = true
    return response.taskAnnotations


  getFinishedTasks : ->

    return @


  getUnfinishedTasks : ->

    filteredTasks = @filter( (task) -> return !task.get("annotation").state.isFinished )
    return new Backbone.Collection(filteredTasks)


  transformToCollection : ->

    tasks = @get("taskAnnotations").map( (el) ->
      return DashboardTaskModel::parse(el)
    )



  getNewTask : ->

    newTask = new TaskModel()

    return newTask.fetch(
      url : @newTaskUrl
      success :  ->
        debugger
        @add(newTask)
    )

