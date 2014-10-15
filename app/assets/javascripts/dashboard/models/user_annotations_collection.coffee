### define
underscore : _
backbone : Backbone
###

class UserAnnotationsCollection extends Backbone.Collection

  comparator : (a, b) ->

    return a.get("created") < b.get("created")


  url : ->

    if @userID
      return "/api/users/#{@userID}/annotations"
    else
      return "/api/user/annotations"


  initialize : (models, options) ->

    @userID = options.userID
    @model = Backbone.Model # important, override a property of the options object


  parse : (response) ->

    @hasSynced = true
    return response.exploratoryAnnotations
