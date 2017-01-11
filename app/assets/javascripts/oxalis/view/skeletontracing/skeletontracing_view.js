import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import Toast from "libs/toast";
import modal from "../modal";
import View from "../../view";

class SkeletonTracingView extends View {

  constructor(model) {
    super(model);
    _.extend(this, Backbone.Events);


    this.listenTo(this.model.skeletonTracing, "emptyBranchStack", () => Toast.error("No more branchpoints", false));
    this.listenTo(this.model.skeletonTracing, "noBranchPoints", () => Toast.error("Setting branchpoints isn't necessary in this tracing mode.", false));
    this.listenTo(this.model.skeletonTracing, "wrongDirection", () => Toast.error("You're tracing in the wrong direction"));


    const autoSaveFailureMessage = "Auto-Save failed!";
    this.listenTo(this.model.skeletonTracing.stateLogger, "pushFailed", function () {
      if (this.reloadDenied) {
        return Toast.error(autoSaveFailureMessage, true);
      } else {
        return modal.show(
          "Several attempts to reach our server have failed. You should \
reload the page to make sure that your work won't be lost.",
          "Connection error",
          [
            {
              id: "reload-button",
              label: "OK, reload",
              callback() {
                app.router.off("beforeunload");
                return app.router.reload();
              },
            },
            {
              id: "cancel-button",
              label: "Cancel",
              callback: () => { this.reloadDenied = true; },
            },
          ],
        );
      }
    });
    this.listenTo(this.model.skeletonTracing.stateLogger, "pushDone", () => Toast.delete("danger", autoSaveFailureMessage));
  }


  showFirstVisToggle() {
    return modal.show("You just toggled the skeleton visibility. To toggle back, just hit the 1-Key.",
      "Skeleton visibility",
      [{ id: "ok-button", label: "OK, Got it." }],
    );
  }
}

export default SkeletonTracingView;
