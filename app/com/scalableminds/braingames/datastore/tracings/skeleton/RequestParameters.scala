package com.scalableminds.braingames.datastore.tracings.skeleton

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import play.api.libs.json.Json

/**
  * Created by f on 25.07.17.
  */


//TODO: Remove all but TracingSelector
case class DownloadTracingParameters(tracingId: String, version: Option[Long], outfileName: String)
case class DownloadMultipleParameters(zipfileName: String, tracings:List[DownloadTracingParameters])
case class TracingSelector(tracingId: String, version: Option[Long] = None)
case class CreateEmptyParameters(boundingBox: Option[BoundingBox] = None, startPosition: Option[Point3D] = None,
                                 startRotation: Option[Vector3D] = None, insertStartAsNode: Option[Boolean] = None,
                                 isFirstBranchPoint: Option[Boolean] = None)

object DownloadTracingParameters {implicit val jsonFormat = Json.format[DownloadTracingParameters]}
object DownloadMultipleParameters {implicit val jsonFormat = Json.format[DownloadMultipleParameters]}
object TracingSelector {implicit val jsonFormat = Json.format[TracingSelector]}
object CreateEmptyParameters {implicit val jsonFormat = Json.format[CreateEmptyParameters]}
