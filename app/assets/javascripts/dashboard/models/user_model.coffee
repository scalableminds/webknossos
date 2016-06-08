_        = require("lodash")
Backbone = require("backbone")

class UserModel extends Backbone.Model

  defaults:
    firstName : ""
    lastName : ""

  url : ->

    if userID = @get("id")
      return "/api/users/#{userID}"
    else
      return "/api/user"


  initialize : (options) ->

    @set("id", options.id)

    # If we don't have a user ID, there is nothing to do and we trigger the
    # right events to the keep the control flow going
    unless @get("id")
      @trigger("sync")

module.exports = UserModel
