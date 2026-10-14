package models.alignmentproject

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.IntervalScheduler
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.actor.ActorSystem
import play.api.inject.ApplicationLifecycle
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

// Uploaded input data of alignment projects is only kept for a limited time, instead of counting towards the storage quota.
class AlignmentProjectInputDataCleanupService @Inject() (
    alignmentProjectDAO: AlignmentProjectDAO,
    alignmentProjectService: AlignmentProjectService,
    wkConf: WkConf,
    val lifecycle: ApplicationLifecycle,
    val actorSystem: ActorSystem
)(implicit val ec: ExecutionContext)
    extends IntervalScheduler
    with LazyLogging {

  override protected def tickerInterval: FiniteDuration = wkConf.WebKnossos.AlignmentProjects.inputDataCleanupInterval

  override protected def tick(): Fox[Unit] =
    for {
      projects <- alignmentProjectDAO.findAllWithExpiredInputData(
        Instant.now - wkConf.WebKnossos.AlignmentProjects.inputDataRetention
      )
      results <- Fox.fromFuture(Fox.serialSequence(projects) { project =>
        logger.info(s"Deleting expired input data of alignment project ${project._id} (${project.name})...")
        alignmentProjectService.deleteInputData(project)
      })
      failedCount = results.count(_.isEmpty)
      _ = if (failedCount > 0) logger.warn(s"Could not delete the expired input data of $failedCount alignment projects.")
    } yield ()
}
