### define
underscore : _
backbone : Backbone
###

class UserAnnotationsCollection extends Backbone.Collection

  comparator = (a, b) ->
    if a.get("created") < b.get("created")
      return 1
    else if a.get("created") > b.get("created")
      return -1
    return 0


  url : ->

    if @userID
      return "/api/users/#{@userID}/annotations"
    else
      return "/api/user/annotations"


  initialize : (models, options) ->

    @userID = options.userID
