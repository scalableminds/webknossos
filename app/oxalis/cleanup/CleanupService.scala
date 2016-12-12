/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.cleanup

import scala.concurrent.duration.FiniteDuration
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Akka
import com.scalableminds.util.tools.Fox
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.{Empty, Failure, Full}

object CleanUpService extends LazyLogging {

  implicit val system = Akka.system(play.api.Play.current)

  def register[T](description: String, interval: FiniteDuration)(job: => Fox[T]) =
    system.scheduler.schedule(interval, interval)(runJob(description, job))

  private def runJob[T](description: String, job: => Fox[T]): Unit = {
    job.futureBox.map{
      case Full(value) =>
        logger.info(s"Completed cleanup job: $description. Result: " + value)
      case f: Failure =>
        logger.warn(s"Failed to execute cleanup job: $description. " + f.msg)
      case Empty =>
        logger.info(s"Completed cleanup job: $description. But result is empty.")
    }.recover{
      case e: Exception =>
        logger.error(s"Exception during execution of cleanup job: $description. ${e.getMessage}", e)
    }
  }
}
