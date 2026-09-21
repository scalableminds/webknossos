import { Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import { mayEditAnnotationProperties } from "viewer/model/accessors/annotation_accessor";
import { setAnnotationNameAction } from "viewer/model/actions/annotation_actions";

export function AnnotationNameBlock() {
  const dispatch = useDispatch();
  const annotationName = useWkSelector((state) => state.annotation.name) || "[unnamed]";
  const task = useWkSelector((state) => state.task);
  const mayEditAnnotation = useWkSelector(mayEditAnnotationProperties);

  if (task != null) {
    // In case we have a task display its id
    return (
      <div className="info-tab-block">
        <p className="sidebar-label">Task ID</p>
        {task.id}
      </div>
    );
  }

  if (!mayEditAnnotation) {
    // For readonly annotations display the non-editable annotation name
    return (
      <div className="info-tab-block">
        <p className="sidebar-label">Annotation Name</p>
        {annotationName}
      </div>
    );
  }

  // Or display the editable annotation name
  return (
    <div className="info-tab-block">
      <p className="sidebar-label">Annotation Name</p>
      <Typography.Text
        editable={{ onChange: (newName) => dispatch(setAnnotationNameAction(newName)) }}
      >
        {annotationName}
      </Typography.Text>
    </div>
  );
}
