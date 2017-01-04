import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import Request from "libs/request";
import FormSyphon from "form-syphon";
import SelectionView from "admin/views/selection_view";
import TeamCollection from "admin/models/team/team_collection";

class DatasetRemoteView extends Marionette.View {
  static initClass() {

    this.prototype.template  = _.template(`\
<div class="row">
  <div class="col-md-6">
    <h3>Add Remote NDStore Dataset</h3>
    <form action="/api/datasets?typ=ndstore" method="POST" class="form-horizontal">
      <div class=" form-group">
        <label class="col-sm-3 control-label" for="name">Name</label>
        <div class="col-sm-9">
        <input type="text" required name="name" value="" class="form-control">
          <span class="help-block errors"></span>
        </div>
      </div>
      <div class=" form-group">
        <label class="col-sm-3 control-label" for="team">Team</label>
        <div class="col-sm-9 team">
          <span class="help-block errors"></span>
        </div>
      </div>
      <div class=" form-group">
        <label class="col-sm-3 control-label" for="server">Server Url</label>
        <div class="col-sm-9">
          <input type="url" required name="server" class="form-control" title="NDstore server location">
          <span class="help-block errors"></span>
        </div>
      </div>
      <div class=" form-group">
        <label class="col-sm-3 control-label" for="token">Token</label>
        <div class="col-sm-9">
          <input type="text" required name="token" class="form-control" title="NDstore token">
          <span class="help-block errors"></span>
        </div>
      </div>
      <div class="form-group">
        <div class="col-sm-9 col-sm-offset-3">
          <button type="submit" class="form-control btn btn-primary">
            Import
          </button>
        </div>
      </div>
    </form>
  </div>
</div>\
`);

    this.prototype.className  = "container";

    this.prototype.regions  =
      {"team" : ".team"};

    this.prototype.events  =
      {"submit form" : "addDataset"};

    this.prototype.ui  =
      {form : "form"};
  }

  initialize() {

    return this.teamSelectionView = new SelectionView({
      collection : new TeamCollection(),
      name : "team",
      childViewOptions : {
        modelValue() { return `${this.model.get("name")}`; }
      },
      data : "amIAnAdmin=true"
    });
  }


  onRender() {

    return this.showChildView("team", this.teamSelectionView);
  }


  addDataset(evt) {

    evt.preventDefault();
    const { form } = this.ui;

    if (form[0].checkValidity()) {

      return Request.sendJSONReceiveJSON("/api/datasets?typ=ndstore",
        {data : FormSyphon.serialize(form)}
      )
      .then(
        function() {
          Toast.success();
          return app.router.navigate("/dashboard", { trigger: true });
        },
        function() {} // NOOP
      );
    }
  }
}
DatasetRemoteView.initClass();


export default DatasetRemoteView;
