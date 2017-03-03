import _ from "lodash";
import Marionette from "backbone.marionette";
import DatasetUploadView from "admin/views/dataset/dataset_upload_view";
import DatasetRemoteView from "admin/views/dataset/dataset_remote_view";


class DatasetAddView extends Marionette.View {
  static initClass() {
    this.prototype.className = "container";
    this.prototype.id = "dataset-add-view";
    this.prototype.template = _.template(`\
<div class="tabbable" id="tabbable-dataset-add">
  <div class="col-md-8">
    <ul class="nav nav-tabs">
      <li class="active">
        <a href="#" id="tab-upload-dataset" data-target="#placeholder" data-toggle="tab">Upload Dataset</a>
      </li>
      <li>
        <a href="#" id="tab-remote-dataset" data-target="#placeholder" data-toggle="tab">Add NDStore Dataset</a>
      </li>
    </ul>
    <div class="tab-content">
      <div class="tab-pane active" id="placeholder"></div>
    </div>
  </div>
</div>\
`);

    this.prototype.regions =
      { tabPane: ".tab-pane" };


    this.prototype.events = {
      "click #tab-upload-dataset": "showUploadDataset",
      "click #tab-remote-dataset": "showRemoteDataset",
    };
  }


  initialize(options) {
    this.options = options;
    this.listenTo(this, "render", this.showUploadDataset);
  }


  showUploadDataset() {
    return this.showChildView("tabPane", new DatasetUploadView(this.options));
  }


  showRemoteDataset() {
    return this.showChildView("tabPane", new DatasetRemoteView(this.options));
  }
}
DatasetAddView.initClass();


export default DatasetAddView;
