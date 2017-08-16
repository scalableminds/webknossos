import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import Request from "libs/request";
import SelectionView from "admin/views/selection_view";
import TeamCollection from "admin/models/team/team_collection";
import DatastoreCollection from "admin/models/datastore/datastore_collection";
import messages from "messages";

class DatasetUploadView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<div class="row">
  <div class="col-md-6">
    <h3>Upload Dataset</h3>
    <form action="/api/datasets/upload" method="POST" class="form-horizontal" enctype="multipart/form-data">
      <div class="form-group">
        <label class="col-sm-3 control-label" for="name">Name</label>
        <div class="col-sm-9">
        <input type="text" required name="name" value="" class="form-control" autofocus pattern="^[0-9a-zA-Z_-]+$" title="Dataset names may only contain letters, numbers, _ and -">
          <span class="help-block errors"></span>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="team">Team</label>
        <div class="col-sm-9 team">
          <span class="help-block errors"></span>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="datastore">Datastore</label>
        <div class="col-sm-9 datastore">
          <span class="help-block errors"></span>
        </div>
      </div>
      <div class="form-group">
        <label class="col-sm-3 control-label" for="zipFile">Dataset ZIP File</label>
        <div class="col-sm-9">

          <div class="fileinput fileinput-new input-group" data-provides="fileinput">
            <div class="form-control" data-trigger="fileinput">
              <i class="fa fa-file fileinput-exists"></i>
              <span class="fileinput-filename"></span>
            </div>
            <span class="input-group-addon btn btn-default btn-file">
              <span class="fileinput-new">Browse...</span>
              <span class="fileinput-exists">Change</span>
              <input type="file" required accept="application/zip" name="zipFile">
            </span>
            <a href="#" class="input-group-addon btn btn-default fileinput-exists" data-dismiss="fileinput">Remove</a>
          </div>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-9 col-sm-offset-3">
          <button type="submit" class="form-control btn btn-primary">
            <i class="fa fa-spinner fa-spin hidden"/>
            Import
          </button>
        </div>
      </div>
    </form>
  </div>
</div>\
`);

    this.prototype.className = "container dataset-administration";

    this.prototype.regions = {
      team: ".team",
      datastore: ".datastore",
    };

    this.prototype.events = {
      "submit form": "uploadDataset",
      "change input[type=file]": "createProject",
    };

    this.prototype.ui = {
      form: "form",
      spinner: ".fa-spinner",
    };
  }

  initialize() {
    this.teamSelectionView = new SelectionView({
      collection: new TeamCollection(),
      name: "team",
      childViewOptions: {
        modelValue() {
          return `${this.model.get("name")}`;
        },
      },
      data: "amIAnAdmin=true",
    });

    this.datastoreSelectionView = new SelectionView({
      collection: new DatastoreCollection(),
      name: "datastore",
      filter(item) {
        return item.get("url") !== null;
      },
      childViewOptions: {
        modelValue() {
          return `${this.model.get("url")}`;
        },
        modelLabel() {
          return `${this.model.get("name")}`;
        },
      },
    });
  }

  onRender() {
    this.showChildView("team", this.teamSelectionView);
    this.showChildView("datastore", this.datastoreSelectionView);
  }

  uploadDataset(evt) {
    evt.preventDefault();
    const form = this.ui.form[0];

    if (form.checkValidity()) {
      Toast.info("Uploading datasets", false);
      this.ui.spinner.removeClass("hidden");

      Request.receiveJSON("/api/dataToken/generate")
        .then(({ token }) =>
          Request.sendMultipartFormReceiveJSON(`/data/datasets?token=${token}`, {
            data: new FormData(form),
            host: form.datastore.value,
          }),
        )
        .then(
          () => {
            Toast.success(messages["dataset.upload_success"]);
            const url = `/datasets/${form.name.value}/import`;
            app.router.navigate(url, { trigger: true });
          },
          () => {
            this.ui.spinner.addClass("hidden");
          },
        );
    }
  }
}
DatasetUploadView.initClass();

export default DatasetUploadView;
