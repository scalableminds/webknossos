import Backbone from "backbone";
import ProjectModel from "./project_model";

class ProjectCollection extends Backbone.Collection {
  static initClass() {
    this.prototype.model = ProjectModel;
    this.prototype.url = "/api/projects";
    this.prototype.idAttribute = "name";
    this.prototype.sortAttribute = "name";
  }
}
ProjectCollection.initClass();

export default ProjectCollection;
