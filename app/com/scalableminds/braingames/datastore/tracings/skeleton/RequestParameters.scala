package com.scalableminds.braingames.datastore.tracings.skeleton

import play.api.libs.json.Json

/**
  * Created by f on 25.07.17.
  */

case class DownloadTracingParameters(tracingId: String, version: Option[Long], outfileName: String)
case class DownloadMultipleParameters(zipfileName: String, tracings:List[DownloadTracingParameters])
case class TracingSelector(tracingId: String, version: Option[Long])

object DownloadTracingParameters {implicit val jsonFormat = Json.format[DownloadTracingParameters]}
object DownloadMultipleParameters {implicit val jsonFormat = Json.format[DownloadMultipleParameters]}
object TracingSelector {implicit val jsonFormat = Json.format[TracingSelector]}
