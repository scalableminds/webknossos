package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Full
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
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

class DSUsedStorageService @Inject() (
    config: DataStoreConfig,
    dataVaultService: DataVaultService,
    managedS3Service: ManagedS3Service
) extends LazyLogging {

  def measureStorageForPaths(paths: List[String], organizationId: String)(implicit
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[List[PathStorageReport]] =
    for {
      // Keep track of original path as its UPath might be normalized and turned into an absolute path.
      // The original path is needed in the returned storage reports to enable the core backend matching with the
      // requested paths and their mags / attachments.
      pathPairs <- Fox.serialCombined(paths) { path =>
        UPath.fromString(path).toFox.map(upath => PathPair(path, upath))
      }
      // Skip remote paths not in our managed S3 and local non-absolute paths (those should never occur)
      pathPairsToMeasure = pathPairs.filter(pair =>
        (pair.upath.isLocal && pair.upath.isAbsolute) || managedS3Service.pathIsInManagedS3(pair.upath)
      )
      vaultPathsForPathPairsToMeasure <- Fox.serialCombined(pathPairsToMeasure)(pathPair =>
        dataVaultService.vaultPathFor(pathPair.upath)
      )
      usedBytes <- Fox.fromFuture(
        Fox.serialSequence(vaultPathsForPathPairsToMeasure)(vaultPath => vaultPath.getUsedStorageBytes)
      )
      pathPairsWithStorageUsedBox = pathPairsToMeasure.zip(usedBytes)
      successfulStorageUsedBoxes = pathPairsWithStorageUsedBox.collect { case (pathPair, Full(usedStorageBytes)) =>
        // Use original path to create the storage report to enable matching in core backend. See comment above.
        PathStorageReport(pathPair.original, usedStorageBytes)
      }
      failedPaths = pathPairsWithStorageUsedBox.collect {
        case (pair, box) if box.isEmpty => pair.original
      }
      _ <- Fox.runIfSeqNonEmpty(failedPaths)(
        logger.error(
          s"Failed to measure storage for ${failedPaths.length} paths: ${failedPaths.take(5).mkString(", ")}${
              if (failedPaths.length > 5) "..."
              else "."
            }"
        )
      )
    } yield successfulStorageUsedBoxes
}
