_                          = require("lodash")
Marionette                 = require("backbone.marionette")
DatasetUploadView          = require("./dataset_upload_view")
DatasetRemoteView          = require("./dataset_remote_view")


class DatasetAddView extends Marionette.View

  className : "container"
  id : "dataset-add-view"
  template : _.template("""
    <div class="tabbable" id="tabbable-dataset-add">
      <div class="col-md-8">
        <ul class="nav nav-tabs">
          <li class="active">
            <a href="#" id="tab-upload-dataset" data-toggle="tab">Upload Dataset</a>
          </li>
          <li>
            <a href="#" id="tab-remote-dataset" data-toggle="tab">Add NDStore Dataset</a>
          </li>
        </ul>
        <div class="tab-content">
          <div class="tab-pane active"></div>
        </div>
      </div>
    </div>
  """)

  regions :
    "tabPane" : ".tab-pane"


  events :
    "click #tab-upload-dataset" : "showUploadDataset"
    "click #tab-remote-dataset" : "showRemoteDataset"


  initialize : (@options) ->

    @listenTo(@, "render", @showUploadDataset)


  showUploadDataset : ->

    @showChildView("tabPane", new DatasetUploadView(@options))


  showRemoteDataset : ->

    @showChildView("tabPane", new DatasetRemoteView(@options))


module.exports = DatasetAddView
