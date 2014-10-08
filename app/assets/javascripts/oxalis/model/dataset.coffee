### define
libs/request : Request
underscore : _
backbone : Backbone
backbone-deep-model : DeepModel
###

class Dataset extends Backbone.DeepModel


  initialize : ->

    @url = "/api/dataSetConfigurations/#{@get('name')}"
    @listenTo(this, "change", @push)


  reset : =>

    Request.send(
      url : "/api/dataSetConfigurations/default"
      dataType : "json"
    ).done( (defaultData) =>
      @set("brightness", defaultData.brightness)
      @set("contrast", defaultData.contrast)
    )


  push : ->

    $.when(@pushThrottled())


  pushThrottled : ->

    saveFkt = @save
    @pushThrottled = _.throttle(_.mutexDeferred( saveFkt, -1), 10000)
    @pushThrottled()
