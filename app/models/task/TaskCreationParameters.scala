package models.task

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import models.user.Experience
import play.api.libs.json.{Format, Json}

case class TaskParameters(
    taskTypeId: String,
    neededExperience: Experience,
    openInstances: Int,
    projectName: String,
    scriptId: Option[String],
    boundingBox: Option[BoundingBox],
    dataSet: String,
    editPosition: Point3D,
    editRotation: Vector3D,
    creationInfo: Option[String],
    description: Option[String],
    baseAnnotation: Option[BaseAnnotation]
)

object TaskParameters {
  implicit val taskParametersFormat: Format[TaskParameters] = Json.format[TaskParameters]
}

case class NmlTaskParameters(taskTypeId: String,
                             neededExperience: Experience,
                             openInstances: Int,
                             projectName: String,
                             scriptId: Option[String],
                             boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat: Format[NmlTaskParameters] = Json.format[NmlTaskParameters]
}

// baseId is the id of the old Annotation which should be used as base for the new annotation, skeletonId/volumeId are the ids of the dupliated tracings from baseId
case class BaseAnnotation(baseId: String, skeletonId: Option[String] = None, volumeId: Option[String] = None)

object BaseAnnotation {
  implicit val baseAnnotationFormat: Format[BaseAnnotation] = Json.format[BaseAnnotation]
}
