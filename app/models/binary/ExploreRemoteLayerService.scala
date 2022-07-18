package models.binary

import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.dataformats.zarr.{RemoteSourceDescriptor, ZarrDataLayer, ZarrMag}
import com.scalableminds.webknossos.datastore.jzarr.ZarrHeader
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer}
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.Box
import net.liftweb.util.Helpers.tryo

import scala.concurrent.ExecutionContext

class ExploreRemoteLayerService @Inject()() extends FoxImplicits with LazyLogging {

  def exploreRemoteLayer(layerUri: String)(implicit ec: ExecutionContext): Fox[DataLayer] = {
    val uri = new URI(layerUri)
    val remoteSource = RemoteSourceDescriptor(uri, None, None)
    for {
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource).toFox ?~> "failed to get file system"
      remotePath <- tryo(fileSystem.getPath(remoteSource.remotePath)) ?~> "failed to get remote path"
      zarrayPath = guessZarrayPath(remotePath)
      zarrHeader <- readZarrHeader(zarrayPath) ?~> s"failed to read zarr header at ${zarrayPath}"
      _ = logger.info(zarrHeader.toString)
      elementClass <- zarrHeader.elementClass
      boundingBox <- zarrHeader.boundingBox
      zarrMag = ZarrMag(Vec3Int.ones, Some(remotePath.toString), credentials = None)
    } yield ZarrDataLayer("layerNameTODO", Category.color, boundingBox, elementClass, List(zarrMag))
  }

  private def readZarrHeader(path: Path): Box[ZarrHeader] = {
    val zarrHeaderString = new String(Files.readAllBytes(path), StandardCharsets.UTF_8)
    JsonHelper.parseJsonToFox[ZarrHeader](zarrHeaderString)
  }

  private def guessZarrayPath(layerPath: Path): Path =
    if (layerPath.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) layerPath
    else layerPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)

}
