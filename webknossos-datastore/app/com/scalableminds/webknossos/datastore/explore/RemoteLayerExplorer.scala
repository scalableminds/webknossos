package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.BoundingBox
import collections.SequenceUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerWithMagLocators, ElementClass}

import scala.concurrent.ExecutionContext

case class MagWithAttributes(
    mag: MagLocator,
    remotePath: VaultPath,
    elementClass: ElementClass.Value,
    boundingBox: BoundingBox
)

trait RemoteLayerExplorer extends FoxImplicits {

  implicit def ec: ExecutionContext

  def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(DataLayerWithMagLocators, VoxelSize)]]

  def name: String

  protected def looksLikeSegmentationLayer(layerName: String, elementClass: ElementClass.Value): Boolean =
    Set("segmentation", "labels").contains(layerName.toLowerCase) && ElementClass.segmentationElementClasses.contains(
      elementClass
    )

  protected def guessNameFromPath(path: VaultPath): String =
    path.basename

  protected def elementClassFromMags(magsWithAttributes: List[MagWithAttributes]): Fox[ElementClass.Value] = {
    val elementClasses = magsWithAttributes.map(_.elementClass)
    SequenceUtils.findUniqueElement(
      elementClasses
    ) ?~> s"Element class must be the same for all mags of a layer. got $elementClasses"
  }

  protected def boundingBoxFromMags(magsWithAttributes: List[MagWithAttributes]): BoundingBox =
    BoundingBox.union(magsWithAttributes.map(_.boundingBox))
}
