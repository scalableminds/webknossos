### define
libs/request : Request
libs/event_mixin : EventMixin
underscore : _
backbone : Backbone
###

class User extends Backbone.Model

  url : "/api/user/userConfiguration"


  constructor : ->

    @listenTo(this, "change", @push)

    super()


  getSettings : ->

    return @attributes


  getMouseInversionX : ->

    return if @get("inverseX") then 1 else -1


  getMouseInversionY : ->

    return if @get("inverseY") then 1 else -1


  triggerAll : ->

    for property of @attributes
      @trigger(property + "Changed", @get(property))


  push : ->

    $.when(@pushThrottled())


  pushThrottled : ->

    saveFkt = @save
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), 10000)
    @pushThrottled()
