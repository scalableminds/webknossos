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
