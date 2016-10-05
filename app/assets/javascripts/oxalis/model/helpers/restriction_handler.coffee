Toast = require("libs/toast")

class RestrictionHandler


  UPDATE_ERROR : "You cannot update this tracing, because you are in Read-only mode!"
  UPDATE_WARNING : "This change will not be persisted, because your are in Read-only mode!"


  constructor : (@restrictions) ->
    @issuedUpdateError = false
    @issuedUpdateWarning = false


  # Should be called whenever the model is modified
  # Returns whether the modification is allowed
  # ==> return if not @restrictionHandler.updateAllowed()
  updateAllowed : (error=true) ->

    if @restrictions.allowUpdate
      return true

    else
      # Display error or warning if it wasn't displayed before
      if error
        if not @issuedUpdateError
          Toast.error(@UPDATE_ERROR)
          @issuedUpdateError = true
      else
        if not @issuedUpdateWarning
          Toast.warning(@UPDATE_WARNING)
          @issuedUpdateWarning = true
      return false


module.exports = RestrictionHandler
