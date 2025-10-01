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

case class PathPair(original: String, upath: UPath)

class DSUsedStorageService @Inject()(config: DataStoreConfig,
                                     remoteSourceDescriptorService: RemoteSourceDescriptorService)
    extends FoxImplicits
    with LazyLogging {

  def measureStorageForPaths(paths: List[String], organizationId: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[PathStorageReport]] = {
    val organizationDirectory = config.Datastore.baseDirectory.resolve(organizationId)
    for {
      // Keep track of original path as its UPath might be normalized and turned into an absolute path.
      // The original path is needed in the returned storage reports to enable the core backend matching with the
      // requested paths and their mags / attachments.
      pathPairs <- Fox.serialCombined(paths) { path =>
        UPath.fromString(path).toFox.map(upath => PathPair(path, upath))
      }
      pathPairsWithAbsoluteUpath = pathPairs.map(pathPair => {
        if (pathPair.upath.getScheme.isEmpty || pathPair.upath.isLocal) {
          pathPair.copy(
            upath = UPath.fromLocalPath(
              organizationDirectory.resolve(pathPair.upath.toLocalPathUnsafe).normalize().toAbsolutePath))
        } else
          pathPair
      })
      // Check to only measure remote paths that are part of a vault that is configured.
      (pathPairsToMeasure, _absoluteUpathsToSkip) = pathPairsWithAbsoluteUpath.partition(
        path =>
          path.upath.isLocal || config.Datastore.DataVaults.credentials.exists(
            vaultCredentialConfig =>
              UPath
                .fromString(vaultCredentialConfig.getString("name"))
                .map(registeredPath => path.upath.startsWith(registeredPath))
                .getOrElse(false)))
      vaultPathsForPathPairsToMeasure <- Fox.serialCombined(pathPairsToMeasure)(pathPair =>
        remoteSourceDescriptorService.vaultPathFor(pathPair.upath))
      usedBytes <- Fox.fromFuture(
        Fox.serialSequence(vaultPathsForPathPairsToMeasure)(vaultPath => vaultPath.getUsedStorageBytes))
      pathPairsWithStorageUsedBox = pathPairsToMeasure.zip(usedBytes)
      successfulStorageUsedBoxes = pathPairsWithStorageUsedBox.collect {
        case (pathPair, Full(usedStorageBytes)) =>
          // Use original path to create the storage report to enable matching in core backend. See comment above.
          PathStorageReport(pathPair.original, usedStorageBytes)
      }
      failedPaths = pathPairsWithStorageUsedBox.filter(p => p._2.isEmpty).map(_._1)
      _ <- Fox.runIfSeqNonEmpty(failedPaths)(logger.error(
        s"Failed to measure storage for ${failedPaths.length} paths: ${failedPaths.take(5).mkString(", ")}${if (failedPaths.length > 5) "..."
        else "."}"))
    } yield successfulStorageUsedBoxes
  }
}
