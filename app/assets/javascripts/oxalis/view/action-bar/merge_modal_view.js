import _ from "lodash";
import Toast from "libs/toast";
import Request from "libs/request";
import app from "app";
import SelectionView from "admin/views/selection_view";
import ModalView from "admin/views/modal_view";
import TaskTypeCollection from "admin/models/tasktype/task_type_collection";
import ProjectCollection from "admin/models/project/project_collection";

class MergeModalView extends ModalView {
  static initClass() {
    this.prototype.headerTemplate = "<h4 class=\"modal-title\">Merge</h4>";
    this.prototype.bodyTemplate = _.template(`\
<div class="form-group">
  <label for="task-type">Task type</label>
  <div class="row">
    <div class="col-md-10 task-type"></div>
    <div class="col-md-2">
      <button class="btn btn-primary" id="task-type-merge">Merge</button>
    </div>
  </div>
</div>
<div class="form-group">
  <label for="project">Project</label>
  <div class="row">
    <div class="col-md-10 project"></div>
    <div class="col-md-2">
      <button class="btn btn-primary" id="project-merge">Merge</button>
    </div>
  </div>
</div>
<div class="form-group">
  <label for="nml">NML</label>
  <div class="row">
    <div class="col-md-10">
      <form action="<%- jsRoutes.controllers.AnnotationIOController.upload().url %>"
          method="POST"
          enctype="multipart/form-data"
          id="upload-and-explore-form"
          class="inline-block">

          <div class="fileinput fileinput-new input-group" data-provides="fileinput">
            <div class="form-control" data-trigger="fileinput">
              <span class="fileinput-filename"></span>
            </div>
            <span class="input-group-addon btn btn-default btn-file">
              <span class="fileinput-new">
                <i class="fa fa-upload"></i>
                Upload NML
              </span>
              <span class="fileinput-exists">
                <i class="fa fa-upload hide" id="form-upload-icon"></i>
                <i class="fa fa-spinner fa-spin" id="form-spinner-icon"></i>
                Change</span>
              <input type="file" name="nmlFile" accept=".nml">
            </span>
          </div>
      </form>
    </div>
    <div class="col-md-2">
      <button class="btn btn-primary" id="nml-merge">Merge</button>
    </div>
  </div>
</div>
<div class="form-group">
  <label for="explorative">Explorative annotations</label>
  <div class="row">
    <div class="col-md-10 explorative">
      <input type="text" class="form-control" placeholder="Explorative annotation id"></input>
    </div>
    <div class="col-md-2">
      <button class="btn btn-primary" id="explorative-merge">Merge</button>
    </div>
  </div>
</div>
<hr>
<div class="checkbox hidden">
  <label>
    <input type="checkbox" id="checkbox-read-only">
    The merged tracing will be read-only.
  </label>
</div>
<div>
  The merged tracing will be saved as a new explorative tracing.
</div>\
`);

    this.prototype.regions = {
      tasktype: ".task-type",
      project: ".project",
    };

    this.prototype.events = {
      "click #task-type-merge": "mergeTaskType",
      "click #project-merge": "mergeProject",
      "click #nml-merge": "mergeNml",
      "change input[type=file]": "selectFiles",
      "submit @ui.uploadAndExploreForm": "uploadFiles",
      "click #explorative-merge": "mergeExplorative",
      "change.bs.fileinput": "selectFiles",
    };

    this.prototype.ui = {
      tasktype: ".task-type",
      project: ".project",
      explorative: ".explorative",
      uploadAndExploreForm: "#upload-and-explore-form",
      formSpinnerIcon: "#form-spinner-icon",
      formUploadIcon: "#form-upload-icon",
      fileInput: ":file",
    };
  }


  initialize() {
    return this.nml = undefined;
  }


  onRender() {
    return Request.receiveJSON("/api/user").then(() => {
      this.taskTypeSelectionView = new SelectionView({
        collection: new TaskTypeCollection(),
        childViewOptions: {
          modelValue() { return `${this.model.get("summary")}`; },
        },
      });
      this.projectSelectionView = new SelectionView({
        collection: new ProjectCollection(),
        childViewOptions: {
          modelValue() { return `${this.model.get("name")}`; },
        },
      });

      this.showChildView("tasktype", this.taskTypeSelectionView);
      return this.showChildView("project", this.projectSelectionView);
    },
    );
  }

  mergeTaskType() {
    const taskTypeId = this.ui.tasktype.find("select :selected").prop("id");
    const url = `/annotations/CompoundTaskType/${taskTypeId}/merge/${this.model.get("tracingType")}/${this.model.get("tracingId")}`;
    return this.merge(url);
  }


  mergeProject() {
    const projectId = this.ui.project.find("select :selected").prop("value");
    const url = `/annotations/CompoundProject/${projectId}/merge/${this.model.get("tracingType")}/${this.model.get("tracingId")}`;
    return this.merge(url);
  }


  mergeNml() {
    if (this.nml) {
      const url = `/annotations/${this.nml.typ}/${this.nml.id}/merge/${this.model.get("tracingType")}/${this.model.get("tracingId")}`;
      return this.merge(url);
    } else {
      return Toast.error("Please upload NML file");
    }
  }


  mergeExplorative() {
    const explorativeId = this.ui.explorative.find("input").val();
    return this.validateId(explorativeId).then(() => {
      const url = `/annotations/Explorational/${explorativeId}/merge/${this.model.get("tracingType")}/${this.model.get("tracingId")}`;
      return this.merge(url);
    },
    );
  }


  merge(url) {
    const readOnly = document.getElementById("checkbox-read-only").checked;

    return Request.receiveJSON(`${url}/${readOnly}`).then((annotation) => {
      Toast.message(annotation.messages);

      const redirectUrl = `/annotations/${annotation.typ}/${annotation.id}`;
      return app.router.loadURL(redirectUrl);
    });
  }


  selectFiles() {
    if (this.ui.fileInput[0].files.length) {
      return this.ui.uploadAndExploreForm.submit();
    }
  }


  toggleIcon(state) {
    this.ui.formSpinnerIcon.toggleClass("hide", state);
    return this.ui.formUploadIcon.toggleClass("hide", !state);
  }


  uploadFiles(event) {
    event.preventDefault();
    this.toggleIcon(false);

    const form = this.ui.uploadAndExploreForm;

    return Request.always(
      Request.sendMultipartFormReceiveJSON(
        form.attr("action"),
        { data: new FormData(form[0]) },
      ).then((data) => {
        this.nml = data.annotation;
        return Toast.message(data.messages);
      },
      ),
      () => this.toggleIcon(true),
    );
  }


  validateId(id) {
    return Request.receiveJSON(`/api/find?q=${id}&type=id`);
  }
}
MergeModalView.initClass();


export default MergeModalView;
