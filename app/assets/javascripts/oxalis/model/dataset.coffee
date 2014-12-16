### define
libs/request : Request
underscore : _
backbone : Backbone
backbone-deep-model : DeepModel
###

class Dataset extends Backbone.DeepModel


  initialize : ->

    @url = "/api/dataSetConfigurations/#{@get('name')}"
    @listenTo(app.vent, "saveEverything", @save)
    @listenTo(this, "change", -> @save())


  reset : =>

    Request.send(
      url : "/api/dataSetConfigurations/default"
      dataType : "json"
    ).done( (defaultData) =>
      @set("brightness", defaultData.brightness)
      @set("contrast", defaultData.contrast)
    )
