_         = require("lodash")
Backbone  = require("backbone")
TaskModel = require("./task_model")

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


  finishedTasksFilter : (task) ->

    return task.get("annotation").state.isFinished


  unfinishedTasksFilter : (task) ->

    return !task.get("annotation").state.isFinished


  getNewTask : ->

    newTask = new TaskModel()

    return newTask.fetch(
      url : @newTaskUrl
      success :  =>
        @add(newTask)
    )


module.exports = UserTasksCollection
