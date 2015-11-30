### define
jquery : $
underscore : _
backbone : Backbone
app : app
oxalis/constants : constants
###

class NonBackboneRouter extends Backbone.Router

  routes :
    "admin/tasks/overview"            : "taskOverview"
    "admin/taskTypes"                 : "hideLoading"
    "annotations/:typ/:id(/readOnly)" : "tracingTrace"
    "datasets/:id/view"               : "tracingView"
    "*url"                            : "hideLoading"


  hideLoading : ->

    $("#loader").hide()


  tracingTrace : ->

    app.router.setReloadFlag()

    require [
      "oxalis/controller"
    ], (Controller) ->

      leftTabBar = $("#main")
      dataUrl = leftTabBar.data("url")

      populateTemplate = (data) ->
        templateSource = _.unescape(leftTabBar.html())
        templateOutput = _.template(templateSource)(data)
        leftTabBar.html(templateOutput)

      $.ajax(
        url: dataUrl
        type: 'GET'
        success: (info) ->

          if info.task
            populateTemplate({task : null})
          else
            populateTemplate({task : info.task})

        error: (xhr, status, error) ->

          console.error("Something went wrong when receiving info data", xhr, status, error)

        complete: (info) ->

          oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_TRACE)
      )

      return


  tracingView : ->

    app.router.setReloadFlag()

    require [
      "oxalis/controller"
      "slider"
    ], (Controller) ->

      oxalis = window.oxalis = new Controller(constants.CONTROL_MODE_VIEW)

      return


  taskOverview : ->

    app.router.setReloadFlag()

    require ["admin/views/task/task_overview_view"], (TaskOverviewView) =>

      new TaskOverviewView(
        el : $("#main-container").find("#task-overview")[0]
      )
      return @hideLoading()

