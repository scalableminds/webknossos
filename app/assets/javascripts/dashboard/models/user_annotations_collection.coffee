_        = require("lodash")
Backbone = require("backbone")
SortedCollection = require("admin/models/sorted_collection")

class UserAnnotationsCollection extends SortedCollection

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
