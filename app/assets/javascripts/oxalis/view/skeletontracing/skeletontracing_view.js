/**
 * skeletontracing_view.js
 * @flow weak
 */

import modal from "oxalis/view/modal";
import View from "oxalis/view";

class SkeletonTracingView extends View {
  // Consider for deletion

  showFirstVisToggle() {
    modal.show("You just toggled the skeleton visibility. To toggle back, just hit the 1-Key.",
      "Skeleton visibility",
      [{ id: "ok-button", label: "OK, Got it." }],
    );
  }
}

export default SkeletonTracingView;
