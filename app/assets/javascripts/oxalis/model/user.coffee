### define
../../libs/request : Request
libs/event_mixin : EventMixin
underscore : _
###

class User

  # To add any user setting, you must define default values in
  # UserConfiguration.scala

  constructor : (user) ->

    _.extend(this, new EventMixin())
    @userSettings = {}
    _.extend(@userSettings, user)


  setValue : (name, value) ->

    @userSettings[name] = value
    @trigger(name + "Changed", value)
    @push()


  get : (name) ->

    return @userSettings[name]


  getSettings : ->

    return @userSettings


  getMouseInversionX : ->

    return if @userSettings.inverseX then 1 else -1


  getMouseInversionY : ->

    return if @userSettings.inverseY then 1 else -1


  triggerAll : ->

    for property of @userSettings
      @trigger(property + "Changed", @get(property)) 


  push : ->

    $.when(@pushThrottled())


  pushThrottled : ->

    saveFkt = @pushImpl
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), 10000)
    @pushThrottled()


  pushImpl : ->

    deferred = $.Deferred()

    console.log "Sending User Data:", @userSettings
      
    Request.send(
      url      : "/user/configuration"
      type     : "POST"
      dataType : "json"
      data     : @userSettings
    ).fail( =>
      
      console.log "couldn't save userdata"

    ).always(-> deferred.resolve())
    
    deferred.promise()    
