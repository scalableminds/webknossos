### define
underscore : _
backbone.marionette : marionette
admin/models/dataset/dataset_collection : DatasetCollection
./credits_view : CreditsView
./spotlight_dataset_list_view : SpotlightDatasetListView
../admin/views/pagination_view : PaginationView
###

class SpotlightView extends Backbone.Marionette.LayoutView

  className : "spotlight-view"
  template : _.template("""
    <div class="container">
      <div id="oxalis-header">
        <img src="/assets/images/oxalis.svg">
        <div><p>webKnossos</p></div>
      </div>
      <div id="pagination"></div>
      <div id="datasets"></div>
    </div>
    <div id="credits"></div>
  """)

  regions :
    pagination : "#pagination"
    credits : "#credits"
    datasets : "#datasets"

  ui :
    credits : "#credits"
    datasets : "#datasets"


  initialize : (options) ->

    @paginationView = new PaginationView(collection: options.collection)
    @spotlightDatasetListView = new SpotlightDatasetListView(collection : options.collection)
    @creditsView = new CreditsView()

    @listenTo(@, "render", @show)


  show : ->

    @pagination.show(@paginationView)
    @datasets.show(@spotlightDatasetListView)
    @credits.show(@creditsView)

