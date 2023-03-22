package models.binary.explore

import com.scalableminds.util.geometry.{BoundingBox, Vec3Double}
import com.scalableminds.util.io.ZipIO
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, ElementClass}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.Reads

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}
import scala.concurrent.ExecutionContext.Implicits.global

case class MagWithAttributes(mag: MagLocator,
                             remotePath: Path,
                             elementClass: ElementClass.Value,
                             boundingBox: BoundingBox)

trait RemoteLayerExplorer extends FoxImplicits {

  def explore(remotePath: Path, credentialId: Option[String]): Fox[List[(DataLayer, Vec3Double)]]

  def name: String

  protected def parseJsonFromPath[T: Reads](path: Path): Fox[T] =
    for {
      fileBytes <- path match {
        case path: VaultPath => path.readBytes() ?~> "dataSet.explore.failed.readFile"
        case _               => tryo(ZipIO.tryGunzip(Files.readAllBytes(path))) ?~> "dataSet.explore.failed.readFile"
      }
      fileAsString <- tryo(new String(fileBytes, StandardCharsets.UTF_8)).toFox ?~> "dataSet.explore.failed.readFile"
      parsed <- JsonHelper.parseAndValidateJson[T](fileAsString)
    } yield parsed

  protected def looksLikeSegmentationLayer(layerName: String, elementClass: ElementClass.Value): Boolean =
    Set("segmentation", "labels").contains(layerName.toLowerCase) && ElementClass.segmentationElementClasses.contains(
      elementClass)

  protected def guessNameFromPath(path: Path): Fox[String] =
    path.toString.split("/").lastOption.toFox

  protected def elementClassFromMags(magsWithAttributes: List[MagWithAttributes]): Fox[ElementClass.Value] = {
    val elementClasses = magsWithAttributes.map(_.elementClass)
    for {
      head <- elementClasses.headOption.toFox
      _ <- bool2Fox(elementClasses.forall(_ == head)) ?~> s"Element class must be the same for all mags of a layer. got $elementClasses"
    } yield head
  }

  protected def boundingBoxFromMags(magsWithAttributes: List[MagWithAttributes]): BoundingBox =
    BoundingBox.union(magsWithAttributes.map(_.boundingBox))
}
