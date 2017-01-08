import _ from "lodash";
import Marionette from "backbone.marionette";
import app from "app";
import Request from "libs/request";
import Constants from "oxalis/constants";
import MergeModalView from "./merge_modal_view";
import ShareModalView from "./share_modal_view";

class DatasetActionsView extends Marionette.View {
  static initClass() {
    this.prototype.SAVED_POLLING_INTERVAL = 1000;

    this.prototype.template = _.template(`\
<% if(tracing.restrictions.allowUpdate){ %>
  <a href="#" class="btn btn-primary" id="trace-save-button">Save</a>
<% } else { %>
  <button class="btn btn-primary disabled">Read only</button>
<% } %>
<% if (hasAdvancedOptions) { %>
  <div class="btn-group btn-group">
    <% if(tracing.restrictions.allowFinish) { %>
      <a href="/annotations/<%- tracingType %>/<%- tracingId %>/finishAndRedirect" class="btn btn-default" id="trace-finish-button"><i class="fa fa-check-circle-o"></i><%- getArchiveBtnText() %></a>
    <% } %>
    <% if(tracing.restrictions.allowDownload || ! tracing.downloadUrl) { %>
      <a class="btn btn-default" id="trace-download-button"><i class="fa fa-download"></i>Download</a>
    <% } %>
    <button class="btn btn-default" id="trace-share-button"><i class="fa fa-share-alt"></i>Share</button>
  </div>

  <% if(tracing.restrictions.allowFinish && tracing.task) { %>
      <button class="btn btn-default" id="trace-next-task-button"><i class="fa fa-step-forward"></i>Finish and Get Next Task</button>
  <% } %>

  <% if (isSkeletonMode) { %>
    <div class="btn btn-default" id="trace-merge-button"><i class="fa fa-folder-open"></i>Merge Tracing</div>
    <div class="merge-modal-wrapper"></div>
  <% } %>
<% } %>\
`);


    this.prototype.events = {
      "click #trace-finish-button": "finishTracing",
      "click #trace-download-button": "downloadTracing",
      "click #trace-save-button": "saveTracing",
      "click #trace-merge-button": "mergeTracing",
      "click #trace-share-button": "shareTracing",
      "click #trace-next-task-button": "getNextTask",
    };

    this.prototype.ui = {
      modalWrapper: ".merge-modal-wrapper",
      saveButton: "#trace-save-button",
    };
  }

  templateContext() {
    return {
      isSkeletonMode: this.isSkeletonMode(),
      getArchiveBtnText() { return this.isTask ? "Finish" : "Archive"; },
      hasAdvancedOptions: this.hasAdvancedOptions(),
    };
  }


  initialize() {
    this.savedPollingInterval = window.setInterval((() => this.updateSavedState()), this.SAVED_POLLING_INTERVAL);
  }


  updateSavedState() {
    if (this.model.annotationModel.stateLogger.stateSaved()) {
      return this.ui.saveButton.text("Saved   ✓");
    }
    return this.ui.saveButton.text("Save");
  }


  finishTracing(evt) {
    evt.preventDefault();
    return this.saveTracing().then(() => {
      if (confirm("Are you sure you want to permanently finish this tracing?")) {
        return app.router.loadURL(evt.currentTarget.href);
      }
    },
    );
  }


  downloadTracing(evt) {
    evt.preventDefault();
    const win = window.open("about:blank", "_blank");
    win.document.body.innerHTML = "Please wait...";
    return this.saveTracing().then(() => {
      win.location.href = this.model.tracing.downloadUrl;
      return win.document.body.innerHTML = "You may close this window after the download has started.";
    },
      // setTimeout(
      //   -> win.close()
      //   2000
      // )
    );
  }


  saveTracing(evt) {
    if (evt) {
      evt.preventDefault();
    }

    return this.model.save();
  }


  mergeTracing() {
    const modalView = new MergeModalView({ model: this.model });
    this.ui.modalWrapper.html(modalView.render().el);
    return modalView.show();
  }


  shareTracing() {
      // save the progress
    const model = this.model.skeletonTracing || this.model.volumeTracing;
    model.stateLogger.save();

    const modalView = new ShareModalView({ model: this.model });
    this.ui.modalWrapper.html(modalView.render().el);
    return modalView.show();
  }


  isSkeletonMode() {
    return _.includes(Constants.MODES_SKELETON, this.model.get("mode"));
  }


  hasAdvancedOptions() {
    return this.model.settings.advancedOptionsAllowed;
  }


  getNextTask() {
    const model = this.model.skeletonTracing || this.model.volumeTracing;
    const finishUrl = `/annotations/${this.model.tracingType}/${this.model.tracingId}/finish`;
    const requestTaskUrl = "/user/tasks/request";

    return model.stateLogger.save()
        .then(() => Request.triggerRequest(finishUrl))
        .then(() => Request.receiveJSON(requestTaskUrl).then(
            (annotation) => {
              const differentTaskType = annotation.task.type.id !== __guard__(this.model.tracing.task, x => x.type.id);
              const differentTaskTypeParam = differentTaskType ? "?differentTaskType" : "";
              const newTaskUrl = `/annotations/${annotation.typ}/${annotation.id}${differentTaskTypeParam}`;
              return app.router.loadURL(newTaskUrl);
            },
            () =>
              // Wait a while so users have a chance to read the error message
              setTimeout((() => app.router.loadURL("/dashboard")), 2000),
          ),
        );
  }


  onDestroy() {
    return window.clearInterval(this.savedPollingInterval);
  }
}
DatasetActionsView.initClass();

export default DatasetActionsView;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
