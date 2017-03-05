import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Marionette from "backbone.marionette";
import Request from "libs/request";
import Store from "oxalis/store";
import Constants from "oxalis/constants";
import MergeModalView from "oxalis/view/action-bar/merge_modal_view";
import ShareModalView from "oxalis/view/action-bar/share_modal_view";

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
    // if (this.model.annotationModel.stateLogger.stateSaved()) {
    //   this.ui.saveButton.text("Saved   ✓");
    // } else {
    //   this.ui.saveButton.text("Save");
    // }
  }


  finishTracing(evt) {
    evt.preventDefault();
    this.saveTracing().then(() => {
      if (confirm("Are you sure you want to permanently finish this tracing?")) {
        app.router.loadURL(evt.currentTarget.href);
      }
    },
    );
  }


  downloadTracing(evt) {
    evt.preventDefault();
    const win = window.open("about:blank", "_blank");
    win.document.body.innerHTML = "Please wait...";
    this.saveTracing().then(() => {
      win.location.href = this.model.tracing.downloadUrl;
      win.document.body.innerHTML = "You may close this window after the download has started.";
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
    modalView.show();
  }


  shareTracing() {
    const modalView = new ShareModalView({ model: this.model });
    this.ui.modalWrapper.html(modalView.render().el);
    modalView.show();
  }


  isSkeletonMode() {
    return _.includes(Constants.MODES_SKELETON, this.model.get("mode"));
  }


  hasAdvancedOptions() {
    return this.model.settings.advancedOptionsAllowed;
  }


  getNextTask() {
    if (this.model.volumeTracing) {
      const model = this.model.volumeTracing;
      const finishUrl = `/annotations/${this.model.tracingType}/${this.model.tracingId}/finish`;
      const requestTaskUrl = "/user/tasks/request";

      model.stateLogger.save()
          .then(() => Request.triggerRequest(finishUrl))
          .then(() => Request.receiveJSON(requestTaskUrl).then(
              (annotation) => {
                const differentTaskType = annotation.task.type.id !== Utils.__guard__(this.model.tracing.task, x => x.type.id);
                const differentTaskTypeParam = differentTaskType ? "?differentTaskType" : "";
                const newTaskUrl = `/annotations/${annotation.typ}/${annotation.id}${differentTaskTypeParam}`;
                return app.router.loadURL(newTaskUrl);
              },
              () =>
                // Wait a while so users have a chance to read the error message
                setTimeout((() => app.router.loadURL("/dashboard")), 2000),
            ),
          );
    } else {
      throw Error("todo");
    }
  }


  onDestroy() {
    window.clearInterval(this.savedPollingInterval);
  }
}
DatasetActionsView.initClass();

export default DatasetActionsView;
