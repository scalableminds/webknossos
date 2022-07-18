package models.binary

import java.net.URI
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path}

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.zarr.RemoteSourceDescriptor
import com.scalableminds.webknossos.datastore.jzarr.ZarrHeader
import com.scalableminds.webknossos.datastore.storage.FileSystemsHolder
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.{Box, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{JsError, JsSuccess, Json}

import scala.concurrent.ExecutionContext

class ExploreRemoteLayerService @Inject()() extends FoxImplicits with LazyLogging {

  def exploreRemoteLayer(layerUri: String)(implicit ec: ExecutionContext): Fox[Unit] = {
    val uri = new URI(layerUri)
    val remoteSource = RemoteSourceDescriptor(uri, None, None)
    for {
      fileSystem <- FileSystemsHolder.getOrCreate(remoteSource).toFox ?~> "failed to get file system"
      remotePath <- tryo(fileSystem.getPath(remoteSource.remotePath)) ?~> "failed to get remote path"
      zarrayPath = guessZarrayPath(remotePath)
      zarrHeader <- readZarrHeader(zarrayPath) ?~> s"failed to read zarr header at ${zarrayPath}"
      _ = logger.info(zarrHeader.toString)
    } yield ()
  }

  private def readZarrHeader(path: Path): Box[ZarrHeader] =
    Full {
      val zarrHeaderString = new String(Files.readAllBytes(path), StandardCharsets.UTF_8)
      val header: ZarrHeader = {
        Json.parse(zarrHeaderString).validate[ZarrHeader] match {
          case JsSuccess(parsedHeader, _) =>
            parsedHeader
          case errors: JsError =>
            throw new Exception("Validating json as zarr header failed: " + JsError.toJson(errors).toString())
        }
      }
      header
    }

  private def guessZarrayPath(layerPath: Path): Path =
    if (layerPath.endsWith(ZarrHeader.FILENAME_DOT_ZARRAY)) layerPath
    else layerPath.resolve(ZarrHeader.FILENAME_DOT_ZARRAY)

}
