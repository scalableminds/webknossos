import $ from "jquery";
import View from "oxalis/view";

class VolumeTracingView extends View {

  constructor(model) {
    super(model);

    $(".skeleton-controls").hide();
    $(".skeleton-plane-controls").hide();
    $(".skeleton-arbitrary-controls").hide();
  }
}

export default VolumeTracingView;
