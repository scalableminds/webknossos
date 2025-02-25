package models.task

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import controllers.LegacyTaskParameters
import models.user.Experience
import play.api.libs.json.{Format, Json}

case class TaskParameters(taskTypeId: ObjectId,
                          neededExperience: Experience,
                          pendingInstances: Int,
                          projectName: String,
                          scriptId: Option[ObjectId],
                          boundingBox: Option[BoundingBox],
                          datasetId: ObjectId,
                          editPosition: Vec3Int,
                          editRotation: Vec3Double,
                          creationInfo: Option[String],
                          description: Option[String],
                          baseAnnotation: Option[BaseAnnotation],
                          newSkeletonTracingId: Option[String],
                          newVolumeTracingId: Option[String],
                          newAnnotationId: Option[ObjectId])

object TaskParameters {
  implicit val taskParametersWithDatasetIdFormat: Format[TaskParameters] =
    Json.format[TaskParameters]

  def fromLegacyTaskParameters(t: LegacyTaskParameters, datasetId: ObjectId) = new TaskParameters(
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
    t.baseAnnotation,
    None,
    None,
    None
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
