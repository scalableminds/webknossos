package com.scalableminds.webknossos.datastore.datareaders.n5

import play.api.libs.json.{Json, OFormat}

case class N5Metadata(multiscales: List[N5MultiscalesItem])

case class N5MultiscalesItem(datasets: List[N5MultiscalesDataset])

case class N5MultiscalesDataset(path: String, transform: N5Transform)

case class N5Transform(axes: List[String], scale: List[Double], units: Option[List[String]])

object N5Metadata {
  implicit val jsonFormat: OFormat[N5Metadata] = Json.format[N5Metadata]

  val FILENAME_ATTRIBUTES_JSON = "attributes.json"
}
object N5MultiscalesItem { implicit val jsonFormat: OFormat[N5MultiscalesItem] = Json.format[N5MultiscalesItem] }
object N5MultiscalesDataset {
  implicit val jsonFormat: OFormat[N5MultiscalesDataset] = Json.format[N5MultiscalesDataset]
}
object N5Transform { implicit val jsonFormat: OFormat[N5Transform] = Json.format[N5Transform] }

// Below are the classes used for the more “compact” multiscales metadata as described in https://github.com/google/neuroglancer/blob/master/src/datasource/n5/index.rst
// Note: only metadata with downsamplingFactors (or scales) in the toplevel are supported at the moment.

case class N5CompactMultiscalesMetadata(axes: Option[List[String]],
                                        downsamplingFactors: Option[List[List[Int]]],
                                        scales: Option[List[List[Int]]],
                                        multiScale: Option[Boolean],
                                        resolution: List[Double],
                                        units: Option[List[String]])

object N5CompactMultiscalesMetadata {
  implicit val jsonFormat: OFormat[N5CompactMultiscalesMetadata] = Json.format[N5CompactMultiscalesMetadata]
}
