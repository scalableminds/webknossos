import Backbone from "backbone";

class ProjectModel extends Backbone.Model {
  static initClass() {
    this.prototype.urlRoot = "/api/projects";
    this.prototype.idAttribute = "name";

    this.prototype.default = {
      owner: {
        firstName: "",
        lastName: "",
      },
      priority: 100,
    };
  }


  isNew() {
    // Workaround. Since we use 'name' as the id attribute, there is no way to
    // know if a model was newly created or fetched from the server
    // Attribute is set in 'create_project_modal_view'
    return this._isNew || false;
  }


  parse(response) {
    // set some sensible defaults
    if (!response.owner) { response.owner = this.default.owner; }
    return response;
  }
}
ProjectModel.initClass();


export default ProjectModel;
