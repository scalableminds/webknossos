package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.box.{Failure, Full}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.{IntervalScheduler, UPath}
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

// Paths in managed S3 are not deleted synchronously when a dataset (or a part of it) is deleted.
// Instead, WEBKNOSSOS queues them, and this service periodically fetches and deletes them.
class ManagedS3PathDeletionService @Inject() (
    config: DataStoreConfig,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    managedS3Service: ManagedS3Service,
    val lifecycle: ApplicationLifecycle,
    val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with Formatter
    with LazyLogging {

  override protected def tickerEnabled: Boolean = config.Datastore.ManagedS3PathDeletion.enabled

  override protected def tickerInterval: FiniteDuration = config.Datastore.ManagedS3PathDeletion.interval

  override protected def tick(): Fox[Unit] =
    if (!managedS3Service.hasGlobalS3Credentials) Fox.successful(())
    else
      for {
        pathsToDelete <- remoteWebknossosClient.getPathsToDelete
        // Other datastores may be responsible for paths this one has no credentials for
        pathsToDeleteHere = pathsToDelete.filter(pathLiteral =>
          UPath.fromString(pathLiteral).exists(managedS3Service.pathIsInManagedS3)
        )
        deletedPaths <- deletePaths(pathsToDeleteHere)
        _ <- Fox.runIf(deletedPaths.nonEmpty)(remoteWebknossosClient.markPathsAsDeleted(deletedPaths))
      } yield ()

  private def deletePaths(pathLiterals: Seq[String]): Fox[Seq[String]] =
    if (pathLiterals.isEmpty) Fox.successful(Seq.empty)
    else {
      logger.info(s"Deleting ${pathLiterals.length} paths from managed S3 as listed by WEBKNOSSOS...")
      for {
        results <- Fox.fromFuture(Fox.serialSequence(pathLiterals) { pathLiteral =>
          for {
            path <- UPath.fromString(pathLiteral).toFox
            _ = logger.info(s"Deleting $path ...")
            _ <- managedS3Service.deleteRecursively(path)
          } yield ()
        })
        deletedPaths = pathLiterals.zip(results).flatMap {
          case (pathLiteral, Full(_))    => Some(pathLiteral)
          case (pathLiteral, f: Failure) =>
            logger.warn(s"Could not delete $pathLiteral from managed S3: ${formatFailureChain(f)}")
            None
          case (pathLiteral, _) =>
            logger.warn(s"Could not delete $pathLiteral from managed S3.")
            None
        }
      } yield deletedPaths
    }

}
