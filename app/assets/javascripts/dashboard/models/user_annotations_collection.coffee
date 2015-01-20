### define
underscore : _
backbone : Backbone
###

class UserAnnotationsCollection extends Backbone.Collection

  comparator : (a, b) ->

    return b.get("created").localeCompare(a.get("created"))


  url : ->

    if @userID
      return "/api/users/#{@userID}/annotations"
    else
      return "/api/user/annotations"


  initialize : (models, options) ->

    @userID = options.userID
