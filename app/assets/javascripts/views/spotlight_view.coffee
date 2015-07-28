### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
./credits_view : CreditsView
./spotlight_dataset_list_view : SpotlightDatasetListView
###

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

