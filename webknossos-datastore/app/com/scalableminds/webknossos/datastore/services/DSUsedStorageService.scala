package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.io.URIUtils
import com.scalableminds.util.tools.{Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import play.api.libs.json.{Json, OFormat}

import java.net.URI
import java.nio.file.Path
import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class DirectoryStorageReport(
    organizationId: String,
    datasetName: String,
    layerName: String,
    magOrDirectoryName: String,
    usedStorageBytes: Long
)

object DirectoryStorageReport {
  implicit val jsonFormat: OFormat[DirectoryStorageReport] = Json.format[DirectoryStorageReport]
}

case class PathStorageUsageRequest(paths: List[String])
object PathStorageUsageRequest {
  implicit val jsonFormat: OFormat[PathStorageUsageRequest] = Json.format[PathStorageUsageRequest]
}

case class PathStorageReport(
    path: String,
    usedStorageBytes: Long
)
object PathStorageReport {
  implicit val jsonFormat: OFormat[PathStorageReport] = Json.format[PathStorageReport]
}

case class PathStorageUsageResponse(reports: List[PathStorageReport])
object PathStorageUsageResponse {
  implicit val jsonFormat: OFormat[PathStorageUsageResponse] = Json.format[PathStorageUsageResponse]
}

class DSUsedStorageService @Inject()(config: DataStoreConfig, dataVaultService: DataVaultService)
    extends FoxImplicits
    with LazyLogging
    with URIUtils {

  private val baseDir: Path = Path.of(config.Datastore.baseDirectory)

  def measureStorageForPaths(paths: List[String], organizationId: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[PathStorageReport]] = {
    val organizationDirectory = baseDir.resolve(organizationId)
    val pathsAsURIs = paths.map(new URI(_))
    val pathsWithAbsoluteURIs = pathsAsURIs.map(uri => {
      if (uri.getScheme == null || uri.getScheme == DataVaultService.schemeFile) {
        organizationDirectory.resolve(uri.getPath).normalize().toAbsolutePath.toUri
      } else
        uri
    })

    // Check to only measure remote paths that are part of a vault that is configured.
    val absolutePathsToMeasure = pathsWithAbsoluteURIs.filter(uri =>
      uri.getScheme == DataVaultService.schemeFile || config.Datastore.DataVaults.credentials.exists(vault =>
        isSubpath(new URI(vault.getString("name")), uri)))
    for {
      vaultPaths <- Fox.serialCombined(absolutePathsToMeasure)(uri =>
        dataVaultService.getVaultPath(RemoteSourceDescriptor(uri, None)))
      usedBytes <- Fox.fromFuture(Fox.serialSequence(vaultPaths)(vaultPath => vaultPath.getUsedStorageBytes))
      pathsWithStorageUsedBox = paths.zip(usedBytes)
      successfulStorageUsedBoxes = pathsWithStorageUsedBox.collect {
        case (path, Full(usedStorageBytes)) =>
          PathStorageReport(path, usedStorageBytes)
      }
      failedPaths = pathsWithStorageUsedBox.filter(p => p._2.isEmpty).map(_._1)
      _ = Fox.runIfNonEmpty(failedPaths)(
        logger.error(
          s"Failed to measure storage for paths ${paths.length} paths: ${failedPaths.take(5).mkString(", ")}."))
    } yield successfulStorageUsedBoxes
  }
}
