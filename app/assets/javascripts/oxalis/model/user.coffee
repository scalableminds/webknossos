### define
underscore : _
backbone : Backbone
app : app
###

class User extends Backbone.Model

  url : "/api/user/userConfiguration"


  initialize : ->

    @listenTo(@, "change", @push)
    @listenTo(app.vent, "saveEverything", @save)
    #@listenTo(@, "change", @save)


  getSettings : ->

    return @attributes


  getMouseInversionX : ->

    return if @get("inverseX") then 1 else -1


  getMouseInversionY : ->

    return if @get("inverseY") then 1 else -1


  triggerAll : ->

    for property of @attributes
      @trigger("change:#{property}", @, @get(property))


