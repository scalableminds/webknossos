package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import play.api.libs.json.{Json, OFormat}

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

class DSUsedStorageService @Inject()(config: DataStoreConfig,
                                     remoteSourceDescriptorService: RemoteSourceDescriptorService)
    extends FoxImplicits
    with LazyLogging {

  def measureStorageForPaths(paths: List[String], organizationId: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[PathStorageReport]] = {
    val organizationDirectory = config.Datastore.baseDirectory.resolve(organizationId)
    for {
      upaths <- Fox.serialCombined(paths)(UPath.fromString(_).toFox)
      absoluteUpaths = upaths.map(path => {
        if (path.getScheme.isEmpty || path.isLocal) {
          UPath.fromLocalPath(organizationDirectory.resolve(path.toLocalPathUnsafe).normalize().toAbsolutePath)
        } else
          path
      })
      // Check to only measure remote paths that are part of a vault that is configured.
      (absoluteUpathsToMeasure, _absoluteUpathsToSkip) = absoluteUpaths.partition(
        path =>
          path.isLocal || config.Datastore.DataVaults.credentials.exists(
            vaultCredentialConfig =>
              UPath
                .fromString(vaultCredentialConfig.getString("name"))
                .map(registeredPath => path.startsWith(registeredPath))
                .getOrElse(false)))
      vaultPaths <- Fox.serialCombined(absoluteUpathsToMeasure)(upath =>
        remoteSourceDescriptorService.vaultPathFor(upath))
      usedBytes <- Fox.fromFuture(Fox.serialSequence(vaultPaths)(vaultPath => vaultPath.getUsedStorageBytes))
      pathsWithStorageUsedBox = vaultPaths.zip(usedBytes)
      successfulStorageUsedBoxes = pathsWithStorageUsedBox.collect {
        case (vaultPath, Full(usedStorageBytes)) =>
          PathStorageReport(vaultPath.toUPath.toString, usedStorageBytes)
      }
      failedPaths = pathsWithStorageUsedBox.filter(p => p._2.isEmpty).map(_._1)
      _ <- Fox.runIfSeqNonEmpty(failedPaths)(logger.error(
        s"Failed to measure storage for ${failedPaths.length} paths: ${failedPaths.take(5).mkString(", ")}${if (failedPaths.length > 5) "..."
        else "."}"))
    } yield successfulStorageUsedBoxes
  }
}
