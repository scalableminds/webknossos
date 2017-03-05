import Backbone from "backbone";
import FormatUtils from "libs/format_utils";
import AnnotationModel from "admin/models/task/annotation_model";

class AnnotationCollection extends Backbone.Collection {
  static initClass() {
    this.prototype.model = AnnotationModel;
  }

  constructor(taskId) {
    super();
    this.url = `/api/tasks/${taskId}/annotations`;
  }

  parse(responses) {
    return responses.map((response) => {
      if (response.tracingTime == null) { response.tracingTime = 0; }
      response.formattedTracingTime = FormatUtils.formatSeconds(response.tracingTime / 1000);

      return response;
    });
  }
}
AnnotationCollection.initClass();

export default AnnotationCollection;
