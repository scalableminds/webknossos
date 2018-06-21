/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.cleanup

import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.concurrent.Akka
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.duration.FiniteDuration

object CleanUpService extends LazyLogging {

  implicit val system = Akka.system(play.api.Play.current)

  @volatile var akkaIsShuttingDown = false

  system.registerOnTermination {
    akkaIsShuttingDown = true
  }

  def register[T](description: String, interval: FiniteDuration, runOnShutdown: Boolean = false)(job: => Fox[T]) =
    system.scheduler.schedule(interval, interval)(runJob(description, job, runOnShutdown))

  private def runJob[T](description: String, job: => Fox[T], runOnShutdown: Boolean): Unit = {
    if (!akkaIsShuttingDown || runOnShutdown) {
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
}
