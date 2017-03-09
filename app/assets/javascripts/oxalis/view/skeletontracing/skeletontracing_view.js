/**
 * skeletontracing_view.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";
// import app from "app";
// import Toast from "libs/toast";
import modal from "oxalis/view/modal";
import View from "oxalis/view";

class SkeletonTracingView extends View {
  // Consider for deletion

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(model) {
    super(model);
    _.extend(this, Backbone.Events);

//     const autoSaveFailureMessage = "Auto-Save failed!";
//     this.listenTo(this.model.skeletonTracing.stateLogger, "pushFailed", function () {
//       if (this.reloadDenied) {
//         Toast.error(autoSaveFailureMessage, true);
//       } else {
//         modal.show(
//           "Several attempts to reach our server have failed. You should \
// reload the page to make sure that your work won't be lost.",
//           "Connection error",
//           [
//             {
//               id: "reload-button",
//               label: "OK, reload",
//               callback() {
//                 app.router.off("beforeunload");
//                 app.router.reload();
//               },
//             },
//             {
//               id: "cancel-button",
//               label: "Cancel",
//               callback: () => { this.reloadDenied = true; },
//             },
//           ],
//         );
//       }
//     });
//     this.listenTo(this.model.skeletonTracing.stateLogger, "pushDone", () => Toast.delete("danger", autoSaveFailureMessage));
  }


  showFirstVisToggle() {
    modal.show("You just toggled the skeleton visibility. To toggle back, just hit the 1-Key.",
      "Skeleton visibility",
      [{ id: "ok-button", label: "OK, Got it." }],
    );
  }
}

export default SkeletonTracingView;
