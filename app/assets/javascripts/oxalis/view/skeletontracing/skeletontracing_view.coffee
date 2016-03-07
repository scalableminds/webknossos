$     = require("jquery")
_     = require("lodash")
Toast = require("libs/toast")
modal = require("../modal")
View  = require("../../view")

class SkeletonTracingView extends View

  constructor : (@model) ->

    super(@model)
    _.extend(@, Backbone.Events)


    @listenTo(@model.skeletonTracing, "emptyBranchStack", ->
      Toast.error("No more branchpoints", false))
    @listenTo(@model.skeletonTracing, "noBranchPoints", ->
      Toast.error("Setting branchpoints isn't necessary in this tracing mode.", false))
    @listenTo(@model.skeletonTracing, "wrongDirection", ->
      Toast.error("You're tracing in the wrong direction"))


    autoSaveFailureMessage = "Auto-Save failed!"
    @listenTo(@model.skeletonTracing.stateLogger, "pushFailed", ->
      if @reloadDenied
        Toast.error(autoSaveFailureMessage,  true)
      else
        modal.show(
          "Several attempts to reach our server have failed. You should
          reload the page to make sure that your work won't be lost.",
          "Connection error",
          [
            {
              id : "reload-button",
              label : "OK, reload",
              callback : ->
                app.router.off("beforeunload")
                app.router.reload()
            },
            {
              id : "cancel-button",
              label : "Cancel",
              callback : => @reloadDenied = true
            }
          ]
        )
    )
    @listenTo(@model.skeletonTracing.stateLogger, "pushDone", ->
      Toast.delete("danger", autoSaveFailureMessage))


  showFirstVisToggle : ->

    modal.show("You just toggled the skeleton visibility. To toggle back, just hit the 1-Key.",
      "Skeleton visibility",
      [{id: "ok-button", label: "OK, Got it."}]
    )

module.exports = SkeletonTracingView
