import NestedObjModel from "libs/nested_obj_model";
import Request from "libs/request";

class DashboardTaskModel extends NestedObjModel {

  parse(annotation) {
    // transform the annotation object which holds a task to a task object which holds its annotation

    const { task } = annotation;

    if (!task) { return; }

    if (!task.type) {
      task.type = this.defaultTaskType(annotation);
    }

    task.annotation = annotation;
    return task;
  }


  defaultTaskType(annotation) {
    return {
      summary: `[deleted] ${annotation.typ}`,
      description: "",
      settings: { allowedModes: "" },
    };
  }


  finish() {
    const annotation = this.get("annotation");
    const url = `/annotations/${annotation.typ}/${annotation.id}/finish`;

    return Request.receiveJSON(url).then(
      (response) => {
        this.set("annotation.state.isFinished", true);
        return response;
      },
    );
  }
}


export default DashboardTaskModel;
