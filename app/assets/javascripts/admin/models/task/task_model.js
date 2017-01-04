import NestedObjModel from "libs/nested_obj_model";
import FormatUtils from "libs/format_utils";

class TaskModel extends NestedObjModel {
  static initClass() {
    this.prototype.defaults = {
      team: "",
      formattedHash: "",
      projectName: "",
      type: null,
      dataSet: "",
      editPosition: [0, 0, 0],
      editRotation: [0, 0, 0],
      boundingBox: null,
      neededExperience: {
        value: 0,
        domain: "",
      },
      created: FormatUtils.formatDate(),
      status: {
        open: 10,
        inProgress: 0,
        completed: 0,
      },
      tracingTime: null,
      isForAnonymous: false,
    };
  }

  url() {
    let id = "";
    if (this.get("id") != null) {
      id = `/${this.get("id")}`;
    }
    return `/api/tasks${id}`;
  }


  destroy() {
    const options = { url: `/api/tasks/${this.get("id")}` };
    return super.destroy(options);
  }
}
TaskModel.initClass();


export default TaskModel;
