### define
underscore : _
backbone : Backbone
###

class UserAnnotationsCollection extends Backbone.Collection

  comparator : (a, b) ->

    return a.get("created") < b.get("created")


  url : ->

    if userID = @get("userID")
      return "/api/users/#{userID}/annotations"
    else
      return "/api/user/annotations"


  parse : (response) ->

    @hasSynced = true
    return response.exploratoryAnnotations
