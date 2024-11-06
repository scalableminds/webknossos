package models.task

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import models.user.Experience
import play.api.libs.json.{Format, Json}

trait TaskParametersTrait[T] {
  val taskTypeId: String
  val neededExperience: Experience
  val pendingInstances: Int
  val projectName: String
  val scriptId: Option[String]
  val boundingBox: Option[BoundingBox]
  val datasetId: T
  val editPosition: Vec3Int
  val editRotation: Vec3Double
  val creationInfo: Option[String]
  val description: Option[String]
  val baseAnnotation: Option[BaseAnnotation]
}

case class TaskParameters(taskTypeId: String,
                          neededExperience: Experience,
                          pendingInstances: Int,
                          projectName: String,
                          scriptId: Option[String],
                          boundingBox: Option[BoundingBox],
                          dataSet: String,
                          datasetId: Option[ObjectId],
                          editPosition: Vec3Int,
                          editRotation: Vec3Double,
                          creationInfo: Option[String],
                          description: Option[String],
                          baseAnnotation: Option[BaseAnnotation])
    extends TaskParametersTrait[Option[ObjectId]]

object TaskParameters {
  implicit val taskParametersFormat: Format[TaskParameters] = Json.format[TaskParameters]
}

case class TaskParametersWithDatasetId(taskTypeId: String,
                                       neededExperience: Experience,
                                       pendingInstances: Int,
                                       projectName: String,
                                       scriptId: Option[String],
                                       boundingBox: Option[BoundingBox],
                                       datasetId: ObjectId,
                                       editPosition: Vec3Int,
                                       editRotation: Vec3Double,
                                       creationInfo: Option[String],
                                       description: Option[String],
                                       baseAnnotation: Option[BaseAnnotation])
    extends TaskParametersTrait[ObjectId]

object TaskParametersWithDatasetId {
  def fromTaskParameters(t: TaskParameters, datasetId: ObjectId) = new TaskParametersWithDatasetId(
    t.taskTypeId,
    t.neededExperience,
    t.pendingInstances,
    t.projectName,
    t.scriptId,
    t.boundingBox,
    datasetId,
    t.editPosition,
    t.editRotation,
    t.creationInfo,
    t.description,
    t.baseAnnotation
  )
}

case class NmlTaskParameters(taskTypeId: String,
                             neededExperience: Experience,
                             pendingInstances: Int,
                             projectName: String,
                             scriptId: Option[String],
                             boundingBox: Option[BoundingBox])

object NmlTaskParameters {
  implicit val nmlTaskParametersFormat: Format[NmlTaskParameters] = Json.format[NmlTaskParameters]
}

// baseId is the id of the old Annotation which should be used as base for the new annotation, skeletonId/volumeId are the ids of the duplicated tracings from baseId
case class BaseAnnotation(baseId: String, skeletonId: Option[String] = None, volumeId: Option[String] = None)

object BaseAnnotation {
  implicit val baseAnnotationFormat: Format[BaseAnnotation] = Json.format[BaseAnnotation]
}
