### define
libs/request : Request
underscore : _
backbone : Backbone
backbone-deep-model : DeepModel
###

class Dataset extends Backbone.DeepModel


  constructor : (dataSetName) ->

    @url = "/api/dataSetConfigurations/#{dataSetName}"

    @listenTo(this, "change", @push)

    super()


  getSettings : ->

    return @attributes


  reset : =>

    Request.send(
      url : "/api/dataSetConfigurations/default"
      dataType : "json"
    ).done( (defaultData) =>
      @set("brightness", defaultData.brightness)
      @set("contrast", defaultData.contrast)
    )


  triggerAll : ->

    for property of @attributes
      @trigger("change:#{property}", this, @get(property))


  push : ->

    $.when(@pushThrottled())


  pushThrottled : ->

    saveFkt = @save
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), 10000)
    @pushThrottled()
