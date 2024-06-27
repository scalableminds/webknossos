package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.BoundingBox
import collections.SequenceUtils
import com.scalableminds.util.tools.TextUtils.normalizeStrong
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{AdditionalAxis, DataLayerWithMagLocators, ElementClass}
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import play.api.libs.json.Reads

import java.nio.charset.StandardCharsets
import scala.concurrent.ExecutionContext

case class MagWithAttributes(mag: MagLocator,
                             remotePath: VaultPath,
                             elementClass: ElementClass.Value,
                             boundingBox: BoundingBox)

trait RemoteLayerExplorer extends FoxImplicits {

  implicit def ec: ExecutionContext

  def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(DataLayerWithMagLocators, VoxelSize)]]

  def name: String

  protected def parseJsonFromPath[T: Reads](path: VaultPath): Fox[T] =
    for {
      fileBytes <- path.readBytes().toFox
      fileAsString <- tryo(new String(fileBytes, StandardCharsets.UTF_8)).toFox ?~> "dataset.explore.failed.readFile"
      parsed <- JsonHelper.parseAndValidateJson[T](fileAsString)
    } yield parsed

  protected def looksLikeSegmentationLayer(layerName: String, elementClass: ElementClass.Value): Boolean =
    Set("segmentation", "labels").contains(layerName.toLowerCase) && ElementClass.segmentationElementClasses.contains(
      elementClass)

  protected def guessNameFromPath(path: VaultPath): String =
    path.basename

  protected def elementClassFromMags(magsWithAttributes: List[MagWithAttributes]): Fox[ElementClass.Value] = {
    val elementClasses = magsWithAttributes.map(_.elementClass)
    SequenceUtils.findUniqueElement(elementClasses) ?~> s"Element class must be the same for all mags of a layer. got $elementClasses"
  }

  protected def boundingBoxFromMags(magsWithAttributes: List[MagWithAttributes]): BoundingBox =
    BoundingBox.union(magsWithAttributes.map(_.boundingBox))

  protected def createAdditionalAxis(name: String, index: Int, bounds: Array[Int]): Box[AdditionalAxis] =
    for {
      normalizedName <- Box(normalizeStrong(name)) ?~ s"Axis name '$name' would be empty if sanitized"
      _ <- Option(bounds.length == 2).collect { case true => () }
    } yield AdditionalAxis(normalizedName, bounds, index)
}
