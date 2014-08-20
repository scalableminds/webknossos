### define
underscore : _
backbone : Backbone
###

class UserAnnotationModel extends Backbone.Model

  urlRoot : ->

    id = @get("id")
    return "/api/users/#{id}/annotations"


  initialize : (options) ->

    @set("id", options.id)
