_        = require("lodash")
Backbone = require("backbone")

class UserAnnotationsCollection extends Backbone.Collection

  comparator : (a, b) ->

    return b.get("created").localeCompare(a.get("created"))


  url : ->

    if @userID
      return "/api/users/#{@userID}/annotations?isFinished=#{@isFinished}"
    else
      return "/api/user/annotations?isFinished=#{@isFinished}"

  initialize : (models, options) ->
    @isFinished = options.isFinished || false
    @userID = options.userID


module.exports = UserAnnotationsCollection
