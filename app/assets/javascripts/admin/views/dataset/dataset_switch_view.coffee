### define
underscore : _
backbone.marionette : marionette
./dataset_list_view : DatasetListView
views/spotlight_dataset_list_view : SpotlightDatasetListView
###

class DatasetSwitchView extends Backbone.Marionette.Layout

  template : _.template("""
    <a href="#" id="showAdvancedView" class="btn btn-default">Show advanced view</a>
    <a href="#" id="showGalleryView" class="btn btn-default">Show gallery view</a>

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

    # Marionette doesn't seem to rebind the events when this view is shown a second time.
    @delegateEvents(@events)
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

