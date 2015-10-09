_                        = require("lodash")
marionette               = require("backbone.marionette")
DatasetCollection        = require("admin/models/dataset/dataset_collection")
CreditsView              = require("./credits_view")
SpotlightDatasetListView = require("./spotlight_dataset_list_view")

class SpotlightView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <div class="container">
      <div id="oxalis-header">
        <img src="/assets/images/oxalis.svg">
        <div><p>webKnossos</p></div>
      </div>
      <div id="datasets"></div>
    </div>
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

    @listenTo(@, "render", @show)


  show : ->

    @datasets.show(@spotlightDatasetListView)
    @credits.show(@creditsView)


module.exports = SpotlightView
