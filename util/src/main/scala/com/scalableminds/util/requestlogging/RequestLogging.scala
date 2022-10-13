package com.scalableminds.util.requestlogging

import java.io.{PrintWriter, StringWriter}

import com.typesafe.scalalogging.LazyLogging
import play.api.http.{HttpEntity, Status}
import play.api.mvc.{Request, Result}

import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._

trait AbstractRequestLogging extends LazyLogging {

  def logRequestFormatted(request: Request[_],
                          result: Result,
                          notifier: Option[String => Unit],
                          requesterId: Option[String] = None): Unit =
    if (!Status.isSuccessful(result.header.status)) {
      val userIdMsg = requesterId.map(id => s" for user $id").getOrElse("")
      val resultMsg = s": ${resultBody(result)}"
      val msg = s"Answering ${result.header.status} at ${request.uri}$userIdMsg$resultMsg"
      logger.warn(msg)
      notifier.foreach(_(msg))
    }

  private def resultBody(result: Result): String =
    result.body match {
      case HttpEntity.Strict(byteString, _) => byteString.take(20000).decodeString("utf-8")
      case _                                => ""
    }

}

trait RequestLogging extends AbstractRequestLogging {
  // Hint: within webKnossos itself, UserAwareRequestLogging is available, which additionally logs the requester user id

  def log(notifier: Option[String => Unit] = None)(block: => Future[Result])(implicit request: Request[_],
                                                                             ec: ExecutionContext): Future[Result] =
    for {
      result: Result <- block
      _ = logRequestFormatted(request, result, notifier)
    } yield result

  def logTime(notifier: String => Unit, durationThreshold: FiniteDuration = 10 seconds)(
      block: => Future[Result])(implicit request: Request[_], ec: ExecutionContext): Future[Result] = {
    def logTimeFormatted(executionTime: Long, request: Request[_], result: Result): Unit = {
      val debugString = s"Request ${request.method} ${request.uri} took ${BigDecimal(executionTime / 1e9)
        .setScale(2, BigDecimal.RoundingMode.HALF_UP)} seconds and was${if (result.header.status != 200) " not "
      else " "}successful"
      logger.info(debugString)
      notifier(debugString)
    }

    val start = System.nanoTime()
    for {
      result: Result <- block
      executionTime = System.nanoTime() - start
      _ = if (executionTime > durationThreshold.toNanos) logTimeFormatted(executionTime, request, result)
    } yield result
  }

}

trait RateLimitedErrorLogging extends LazyLogging {
  // Allows to log errors that occur many times only once (per lifetime of the class)

  private val loggedErrorMessages = scala.collection.mutable.Set[String]()

  protected def logError(t: Throwable): Unit =
    t match {
      case e: Exception =>
        if (!loggedErrorMessages.contains(e.getMessage)) {
          loggedErrorMessages.add(e.getMessage)
          val sw = new StringWriter
          e.printStackTrace(new PrintWriter(sw))
          logger.error(sw.toString)
        }
      case _ => ()
    }

}
