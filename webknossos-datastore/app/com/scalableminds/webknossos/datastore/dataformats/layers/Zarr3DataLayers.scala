package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import play.api.libs.json.{Json, OFormat}

trait Zarr3Layer extends DataLayerWithMagLocators {
  val dataFormat: DataFormat.Value = DataFormat.zarr3
}

case class Zarr3DataLayer(
    name: String,
    category: Category.Value,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None
) extends Zarr3Layer

object Zarr3DataLayer {
  implicit val jsonFormat: OFormat[Zarr3DataLayer] = Json.format[Zarr3DataLayer]
}

case class Zarr3SegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    largestSegmentId: Option[Long] = None,
    mappings: Option[Set[String]] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None
) extends SegmentationLayer
    with Zarr3Layer

object Zarr3SegmentationLayer {
  implicit val jsonFormat: OFormat[Zarr3SegmentationLayer] = Json.format[Zarr3SegmentationLayer]
}
