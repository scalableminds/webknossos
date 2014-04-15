### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
./credits_view : CreditsView
./spotlight_dataset_list_view : SpotlightDatasetListView
###

class SpotlightView extends Backbone.Marionette.Layout

  className : "container"

  template : _.template("""
    <div id="oxalis-header">
      <img src="/assets/images/oxalis.svg">
      <div><p>Oxalis</p></div>
    </div>
    <div id="datasets"></div>
    <div id="credits"></div>
  """)

  regions :
    credits : "#credits"
    datasets : "#datasets"

  ui :
    credits : "#credits"
    datasets : "#datasets"


  initialize : (options) ->

    @spotlightDatasetListView = new SpotlightDatasetListView(collection : options.model)
    @creditsView = new CreditsView()

    # TODO: fix this workaround
    setTimeout((=> @show()), 1000)


  show : ->

    @datasets.show(@spotlightDatasetListView)
    @credits.show(@creditsView)

