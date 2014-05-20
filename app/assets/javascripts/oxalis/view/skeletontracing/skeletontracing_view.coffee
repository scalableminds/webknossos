### define
jquery : $
underscore : _
libs/toast : Toast
../modal : modal
../../view : View
###

class SkeletonTracingView extends View

  constructor : (@model) ->

    super(@model)
    _.extend(@, Backbone.Events)


    @listenTo(app.vent, "activeNode:change", @updateActiveTree)

    @model.skeletonTracing.on({
      emptyBranchStack : =>

        Toast.error("No more branchpoints", false)


      noBranchPoints : =>

        Toast.error("Setting branchpoints isn't necessary in this tracing mode.", false)


      wrongDirection : =>

        Toast.error("You're tracing in the wrong direction")
    })


    @model.skeletonTracing.stateLogger.on
      pushFailed : =>
        if @reloadDenied
          Toast.error("Auto-Save failed!")
        else
          modal.show("Several attempts to reach our server have failed. You should reload the page
            to make sure that your work won't be lost.",
            [ { id : "reload-button", label : "OK, reload", callback : ( ->
              $(window).on(
                "beforeunload"
                => return null)
              window.location.reload() )},
            {id : "cancel-button", label : "Cancel", callback : ( => @reloadDenied = true ) } ] )



  showFirstVisToggle : ->

    modal.show("You just toggled the skeleton visibility. To toggle back, just hit the 1-Key.",
      [{id: "ok-button", label: "OK, Got it."}])


  toggleIconVisibility : (isFirst, firstIcon, secondIcon) ->

    if isFirst
      firstIcon.show()
      secondIcon.hide()
    else
      firstIcon.hide()
      secondIcon.show()
