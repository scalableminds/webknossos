package models.task

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.AutoFormat
import models.user.Experience

case class TaskParameters(
    taskTypeId: ObjectId,
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
    newAnnotationId: Option[ObjectId]
) derives AutoFormat

case class NmlTaskParameters(
    taskTypeId: ObjectId,
    neededExperience: Experience,
    pendingInstances: Int,
    projectName: String,
    scriptId: Option[ObjectId],
    boundingBox: Option[BoundingBox]
) derives AutoFormat

// baseId is the id of the old Annotation which should be used as base for the new annotation, skeletonId/volumeId are the ids of the duplicated tracings from baseId
case class BaseAnnotation(baseId: String, skeletonId: Option[String] = None, volumeId: Option[String] = None)
    derives AutoFormat
