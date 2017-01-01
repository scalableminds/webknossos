import _ from "lodash";
import backbone from "backbone";

class AnnotationModel extends Backbone.Model {
  static initClass() {
  
    this.prototype.urlRoot  = "/annotations/task/";
  }
}
AnnotationModel.initClass();

export default AnnotationModel;
