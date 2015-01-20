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


  getFinishedTasks : ->

    return @


  getUnfinishedTasks : ->

    return @filter( (task) -> return !task.get("annotation").state.isFinished )


  getNewTask : ->

    newTask = new TaskModel()

    return newTask.fetch(
      url : @newTaskUrl
      success :  =>
        @add(newTask)
    )

