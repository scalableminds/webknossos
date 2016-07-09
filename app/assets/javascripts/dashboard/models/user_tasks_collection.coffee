_                   = require("lodash")
Backbone            = require("backbone")
DashboardTaskModel  = require("./dashboard_task_model")
SortedCollection    = require("admin/models/sorted_collection")

class UserTasksCollection extends SortedCollection

  model : DashboardTaskModel
  newTaskUrl : "/user/tasks/request"
  defaults :
      showFinishedTasks : false

  url : ->

    if @userID
      return "/api/users/#{@userID}/tasks?isFinished=#{@isFinished}"
    else
      return "/api/user/tasks?isFinished=#{@isFinished}"


  initialize : (models, options) ->

    @userID = options.userID
    @isFinished = options.isFinished || false


  unfinishedTasksFilter : (task) ->

    return !task.get("annotation.state.isFinished")


  getNewTask : ->

    newTask = new DashboardTaskModel()

    return newTask.fetch(
      url : @newTaskUrl
      success :  =>
        @add(newTask)
    )



module.exports = UserTasksCollection
