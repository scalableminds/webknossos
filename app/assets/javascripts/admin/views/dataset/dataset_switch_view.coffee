### define
underscore : _
backbone.marionette : marionette
./dataset_list_view : DatasetListView
views/spotlight_dataset_list_view : SpotlightDatasetListView
###

class DatasetSwitchView extends Backbone.Marionette.Layout

  template : _.template("""
    <div class="pull-right">
      <a href="#" id="showAdvancedView" class="btn btn-default">
        <i class="fa fa-th-list"></i>Show advanced view
      </a>
      <a href="#" id="showGalleryView" class="btn btn-default">
        <i class="fa fa-th"></i>Show gallery view
      </a>
    </div>

    <h3>Datasets</h3>

    <div class="dataset-region"></div>
  """)

  ui :
    "showAdvancedButton" : "#showAdvancedView"
    "showGalleryButton" : "#showGalleryView"

  events :
    "click @ui.showAdvancedButton" : "showAdvancedView"
    "click @ui.showGalleryButton" : "showGalleryView"


  regions :
    "datasetPane" : ".dataset-region"


  onShow : ->

    @ui.showAdvancedButton.hide()
    @showGalleryView()


  toggleSwitchButtons : ->

    [@ui.showAdvancedButton, @ui.showGalleryButton].map((button) -> button.toggle())


  showGalleryView : ->

    @toggleSwitchButtons()

    unless @datasetGalleryView
      @datasetGalleryView = new SpotlightDatasetListView(collection : @model)

    @datasetPane.show(@datasetGalleryView)


  showAdvancedView : ->

    @toggleSwitchButtons()

    unless @datasetListView
      @datasetListView = new DatasetListView(collection: @model)

    @datasetPane.show(@datasetListView)

