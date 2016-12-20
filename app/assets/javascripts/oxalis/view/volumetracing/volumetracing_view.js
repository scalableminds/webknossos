import $ from "jquery";
import View from "../../view";

class VolumeTracingView extends View {

  constructor(model) {

    super(model);
    this.model = model;

    $(".skeleton-controls").hide();
    $(".skeleton-plane-controls").hide();
    $(".skeleton-arbitrary-controls").hide();
  }
}

export default VolumeTracingView;
