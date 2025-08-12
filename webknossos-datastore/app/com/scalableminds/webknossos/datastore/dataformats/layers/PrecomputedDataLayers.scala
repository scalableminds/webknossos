package com.scalableminds.webknossos.datastore.dataformats.layers

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource._
import play.api.libs.json.{Json, OFormat}

trait PrecomputedLayer extends DataLayerWithMagLocators {
  val dataFormat: DataFormat.Value = DataFormat.neuroglancerPrecomputed
}

case class PrecomputedDataLayer(
    name: String,
    boundingBox: BoundingBox,
    category: Category.Value,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None,
) extends PrecomputedLayer

object PrecomputedDataLayer {
  implicit val jsonFormat: OFormat[PrecomputedDataLayer] = Json.format[PrecomputedDataLayer]
}

case class PrecomputedSegmentationLayer(
    name: String,
    boundingBox: BoundingBox,
    elementClass: ElementClass.Value,
    mags: List[MagLocator],
    largestSegmentId: Option[Long],
    mappings: Option[Set[String]] = None,
    defaultViewConfiguration: Option[LayerViewConfiguration] = None,
    adminViewConfiguration: Option[LayerViewConfiguration] = None,
    coordinateTransformations: Option[List[CoordinateTransformation]] = None,
    override val numChannels: Option[Int] = Some(1),
    additionalAxes: Option[Seq[AdditionalAxis]] = None,
    attachments: Option[DatasetLayerAttachments] = None,
) extends SegmentationLayer
    with PrecomputedLayer

object PrecomputedSegmentationLayer {
  implicit val jsonFormat: OFormat[PrecomputedSegmentationLayer] = Json.format[PrecomputedSegmentationLayer]
}
