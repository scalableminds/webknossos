package com.scalableminds.util.requestlogging

import com.typesafe.scalalogging.LazyLogging
import play.api.http.HttpEntity
import play.api.mvc.{Request, Result}

import scala.concurrent.{ExecutionContext, Future}

trait AbstractRequestLogging extends LazyLogging {

  def logRequestFormatted(request: Request[_], result: Result, userMail: Option[String] = None) = {
    val emailMsg = userMail.map(m => s" for $m").getOrElse("")
    result.body match {
      case HttpEntity.Strict(byteString, contentType) if result.header.status != 200 =>
        logger.warn(
          s"Answering ${result.header.status} at ${request.uri}$emailMsg – ${byteString.take(20000).decodeString("utf-8")}")
      case _ => ()
    }
  }

}

trait RequestLogging extends AbstractRequestLogging {
  // Hint: within webKnossos itself, UserAwareRequestLogging is available, which additionally logs the requester email

  def log(block: => Future[Result])(implicit request: Request[_], ec: ExecutionContext): Future[Result] =
    for {
      result: Result <- block
      _ = logRequestFormatted(request, result)
    } yield result

  def logTime(block: => Future[Result])(implicit request: Request[_], ec: ExecutionContext): Future[Result] = {
    def logTimeFormatted(executionTime: Long, request: Request[_], result: Result) =
      logger.info(s"Request ${request.method} ${request.uri} took ${BigDecimal(executionTime / 1e9)
        .setScale(2, BigDecimal.RoundingMode.HALF_UP)} seconds and was${if (result.header.status != 200) " not "
      else " "}successfull")

    val start = System.nanoTime()
    for {
      result: Result <- block
      _ = if (request.uri.contains("volume")) logTimeFormatted(System.nanoTime() - start, request, result)
    } yield result
  }

  def log(block: => Result)(implicit request: Request[_], ec: ExecutionContext): Result = {
    val result: Result = block
    logRequestFormatted(request, result)
    result
  }

}
