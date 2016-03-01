_                        = require("lodash")
Marionette               = require("backbone.marionette")
CreditsView              = require("./credits_view")
SpotlightDatasetListView = require("./spotlight_dataset_list_view")
PaginationView           = require("admin/views/pagination_view")

class SpotlightView extends Marionette.LayoutView

  className : "spotlight-view"
  template : _.template("""
    <div class="container">
      <div id="oxalis-header">
        <img src="/assets/images/oxalis.svg">
        <div><p>webKnossos</p></div>
      </div>
      <div id="pagination"></div>
      <div id="datasets" class="container wide"></div>
    </div>
    <div id="credits"></div>
  """)

  regions :
    pagination : "#pagination"
    credits : "#credits"
    datasets : "#datasets"


  initialize : ->

    @paginationView = new PaginationView(collection: @collection)
    @spotlightDatasetListView = new SpotlightDatasetListView(collection : @collection)

    @creditsView = new CreditsView()

    @collection.fetch({ data : "isActive=true" })
    @listenTo(@, "render", @show)


  show : ->

    @pagination.show(@paginationView)
    @datasets.show(@spotlightDatasetListView)
    @credits.show(@creditsView)


module.exports = SpotlightView
