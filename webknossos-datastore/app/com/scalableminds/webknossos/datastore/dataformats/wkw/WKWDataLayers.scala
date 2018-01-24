/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.dataformats.wkw

import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.util.geometry.{BoundingBox, Point3D}
import play.api.libs.json.{Format, JsResult, JsValue, Json}

case class WKWResolution(resolution: Either[Int, Point3D], cubeLength: Int)

object WKWResolution {
  implicit val jsonFormat: Format[WKWResolution] = new Format[WKWResolution] {
    def reads(json: JsValue): JsResult[WKWResolution] = {
      for {
        resolution <- (json \ "resolution").validate[Int].map(Left(_)).orElse((json \ "resolution").validate[Point3D].map(Right(_)))
        cubeLength <- (json \ "cubeLength").validate[Int]
      } yield {
        WKWResolution(resolution, cubeLength)
      }
    }

    def writes(r: WKWResolution) = Json.obj(
      "resolution" -> r.resolution.fold(x => x, Point3D.Point3DWrites.writes),
      "cubeLength" -> r.cubeLength
    )
  }
}

trait WKWLayer extends DataLayer {

  val dataFormat = DataFormat.wkw

  lazy val bucketProvider = new WKWBucketProvider(this)

  def wkwResolutions: List[WKWResolution]

  def resolutions = wkwResolutions.map(_.resolution).map {
    case Left(r) =>
      Point3D(r, r, r)
    case Right(r) =>
      r
  }

  def lengthOfUnderlyingCubes(resolution: Int): Int = {
    wkwResolutions.find(_.resolution == resolution).map(_.cubeLength).getOrElse(0)
  }
}

case class WKWDataLayer(
                         name: String,
                         category: Category.Value,
                         boundingBox: BoundingBox,
                         wkwResolutions: List[WKWResolution],
                         elementClass: ElementClass.Value
                       ) extends WKWLayer

object WKWDataLayer {
  implicit val wkwDataLayerFormat = Json.format[WKWDataLayer]
}

case class WKWSegmentationLayer(
                                 name: String,
                                 boundingBox: BoundingBox,
                                 wkwResolutions: List[WKWResolution],
                                 elementClass: ElementClass.Value,
                                 mappings: Set[String],
                                 largestSegmentId: Long
                               ) extends SegmentationLayer with WKWLayer

object WKWSegmentationLayer {
  implicit val wkwSegmentationLayerFormat = Json.format[WKWSegmentationLayer]
}
