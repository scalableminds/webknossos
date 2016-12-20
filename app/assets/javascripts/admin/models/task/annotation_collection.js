import _ from "lodash";
import backbone from "backbone";
import AnnotationModel from "./annotation_model";
import FormatUtils from "libs/format_utils";

class AnnotationCollection extends Backbone.Collection {
  static initClass() {

    this.prototype.model  = AnnotationModel;
  }

  constructor(taskId) {
    super();
    // TODO: This line was before super in coffee, which is not allowed in
    // ES6. Check if this is ok respectively fix it.
    this.url = `/api/tasks/${taskId}/annotations`;
  }

  parse(responses) {

    return responses.map(function(response) {

      if (response.tracingTime == null) { response.tracingTime = 0; }
      response.formattedTracingTime = FormatUtils.formatSeconds(response.tracingTime / 1000);

      return response;
    });
  }
}
AnnotationCollection.initClass();

export default AnnotationCollection;
