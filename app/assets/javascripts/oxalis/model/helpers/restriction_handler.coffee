Toast = require("libs/toast")

class RestrictionHandler


  UPDATE_ERROR : "You cannot update this tracing, because you are in Read-only mode!"


  constructor : (@restrictions) ->
    @issuedUpdateError = false


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

module.exports = RestrictionHandler
