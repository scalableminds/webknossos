package com.scalableminds.util.requestlogging

import com.scalableminds.util.time.Instant
import com.typesafe.scalalogging.LazyLogging
import play.api.http.{HttpEntity, Status}
import play.api.mvc.{Request, Result}

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

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

  def logTime(notifier: String => Unit, durationThreshold: FiniteDuration = 30 seconds)(
      block: => Future[Result])(implicit request: Request[_], ec: ExecutionContext): Future[Result] = {
    def logTimeFormatted(executionTime: FiniteDuration, request: Request[_], result: Result): Unit = {
      val debugString =
        s"Request ${request.method} ${request.uri} took ${BigDecimal(executionTime.toMillis.toDouble / 1000)
          .setScale(2, BigDecimal.RoundingMode.HALF_UP)} seconds and was${if (result.header.status != 200) " not "
        else " "}successful"
      logger.info(debugString)
      notifier(debugString)
    }

    val start = Instant.now
    for {
      result: Result <- block
      executionTime = Instant.since(start)
      _ = if (executionTime > durationThreshold) logTimeFormatted(executionTime, request, result)
    } yield result
  }

}

trait RequestLogging extends AbstractRequestLogging {
  // Hint: within webknossos itself, UserAwareRequestLogging is available, which additionally logs the requester user id

  def log(notifier: Option[String => Unit] = None)(block: => Future[Result])(implicit request: Request[_],
                                                                             ec: ExecutionContext): Future[Result] =
    for {
      result: Result <- block
      _ = logRequestFormatted(request, result, notifier)
    } yield result

}
