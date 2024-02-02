package cleanup

import org.apache.pekko.actor.{ActorSystem, Cancellable}
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import net.liftweb.common.{Empty, Failure, Full}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

class CleanUpService @Inject()(system: ActorSystem)(implicit ec: ExecutionContext) extends LazyLogging {

  @volatile private var pekkoIsShuttingDown = false

  system.registerOnTermination {
    pekkoIsShuttingDown = true
  }

  def register[T](description: String, interval: FiniteDuration, runOnShutdown: Boolean = false)(
      job: => Fox[T]): Cancellable =
    system.scheduler.scheduleWithFixedDelay(interval, interval)(() => runJob(description, job, runOnShutdown))

  private def runJob[T](description: String, job: => Fox[T], runOnShutdown: Boolean): Unit =
    if (!pekkoIsShuttingDown || runOnShutdown) {
      job.futureBox.map {
        case Full(value) =>
          logger.info(s"Completed cleanup job: $description. Result: " + value)
        case f: Failure =>
          logger.warn(s"Failed to execute cleanup job: $description. " + f.msg)
        case Empty =>
          logger.info(s"Completed cleanup job: $description. But result is empty.")
      }.recover {
        case e: Exception =>
          logger.error(s"Exception during execution of cleanup job: $description. ${e.getMessage}", e)
      }
    }
}
