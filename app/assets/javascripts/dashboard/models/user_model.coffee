_        = require("lodash")
Backbone = require("backbone")

class UserModel extends Backbone.Model

  urlRoot : ->

    if @get("id")
      return "/api/users/"
    else
      return "/api/user"


  initialize : (options) ->

    @set("id", options.id)

module.exports = UserModel
