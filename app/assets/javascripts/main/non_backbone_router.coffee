### define
jquery : $
underscore : _
backbone : Backbone
oxalis/constants : constants
###

class NonBackboneRouter extends Backbone.Router

  routes :
    "admin/tasks/overview"          : "taskOverview"
    "admin/taskTypes"               : "hideLoading"


  taskOverview : ->

    require ["admin/views/task/task_overview_view"], (TaskOverviewView) =>

      new TaskOverviewView(
        el : $("#main-container").find("#task-overview")[0]
      )
      return @hideLoading()
