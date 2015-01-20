### define
underscore : _
backbone : Backbone
###

class UserModel extends Backbone.Model


  defaults:
    firstName : ""
    lastName : ""

  urlRoot : "/api/users"

  initialize : (options) ->

    # If we don't have a user ID, there is nothing to do and we trigger the
    # right events to the keep the control flow going
    unless @id
      @trigger("sync")

