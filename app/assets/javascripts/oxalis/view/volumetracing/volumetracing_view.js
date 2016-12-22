import $ from "jquery";
import View from "../../view";

class VolumeTracingView extends View {

  constructor(model) {

    this.model = model;
    super(this.model);

    $(".skeleton-controls").hide();
    $(".skeleton-plane-controls").hide();
    $(".skeleton-arbitrary-controls").hide();
  }
}

export default VolumeTracingView;
