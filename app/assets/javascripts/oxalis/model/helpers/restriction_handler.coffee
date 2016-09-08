Toast = require("libs/toast")

class RestrictionHandler


  UPDATE_ERROR : "You cannot update this tracing, because you are in Read-only mode!"
  UPDATE_WARNING : "This change will not be persisted, because your are in Read-only mode!"


  constructor : (@restrictions) ->
    @issuedUpdateError = false
    @issuedUpdateWarning = false


  # Should be called whenever the model is modified
  # Returns whether the modification should be aborted
  # ==> return if @restrictionHandler.handleUpdate()
  handleUpdate : ->

    if @restrictions.allowUpdate
      return false

    else
      if not @issuedUpdateError
        Toast.error(@UPDATE_ERROR)
        @issuedUpdateError = true
      return true


  # Should be called whenever the model is modified
  # but should be changed regardless of the restriction settings
  # Returns whether the change should be persisted on the server
  # ==> if @restrictionHandler.forceHandleUpdate()
  #    @stateLogger.update...
  forceHandleUpdate : ->

    if @restrictions.allowUpdate
      return true

    else
      # issue a non-persistence warning to the user
      if not @issuedUpdateWarning
        Toast.warning(@UPDATE_WARNING)
        @issuedUpdateWarning = true
      return false


module.exports = RestrictionHandler
