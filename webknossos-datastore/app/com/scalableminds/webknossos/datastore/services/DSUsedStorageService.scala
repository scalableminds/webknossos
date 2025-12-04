package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, Full}
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.webknossos.datastore.storage.DataVaultService
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
                                     dataVaultService: DataVaultService,
                                     managedS3Service: ManagedS3Service)
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
      (pathPairsToMeasure, _absoluteUpathsToSkip) = pathPairsWithAbsoluteUpath.partition(path =>
        path.upath.isLocal || managedS3Service.pathIsInManagedS3(path.upath))
      vaultPathsForPathPairsToMeasure <- Fox.serialCombined(pathPairsToMeasure)(pathPair =>
        dataVaultService.vaultPathFor(pathPair.upath))
      usedBytes <- Fox.fromFuture(
        Fox.serialSequence(vaultPathsForPathPairsToMeasure)(vaultPath => vaultPath.getUsedStorageBytes))
      pathPairsWithStorageUsedBox = pathPairsToMeasure.zip(usedBytes)
      successfulStorageUsedBoxes = pathPairsWithStorageUsedBox.collect {
        case (pathPair, Full(usedStorageBytes)) =>
          // Use original path to create the storage report to enable matching in core backend. See comment above.
          PathStorageReport(pathPair.original, usedStorageBytes)
      }
      failedPaths = pathPairsWithStorageUsedBox.collect {
        case (pair, box) if box.isEmpty => pair.original
      }
      _ <- Fox.runIfSeqNonEmpty(failedPaths)(logger.error(
        s"Failed to measure storage for ${failedPaths.length} paths: ${failedPaths.take(5).mkString(", ")}${if (failedPaths.length > 5) "..."
        else "."}"))
    } yield successfulStorageUsedBoxes
  }
}
