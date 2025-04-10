package com.scalableminds.webknossos.datastore.rpc

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.mvc.{Formatter, MimeTypes}
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import play.api.http.{HeaderNames, Status}
import play.api.libs.json._
import play.api.libs.ws._
import com.scalableminds.util.time.Instant
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import java.io.File
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class RPCRequest(val id: Int, val url: String, wsClient: WSClient)(implicit ec: ExecutionContext)
    extends LazyLogging
    with Formatter
    with MimeTypes {

  var request: WSRequest = wsClient.url(url)
  private var verbose: Boolean = true
  private var slowRequestLoggingThreshold = 2 minutes

  def addQueryString(parameters: (String, String)*): RPCRequest = {
    request = request.addQueryStringParameters(parameters: _*)
    this
  }

  def withTokenFromContext(implicit tc: TokenContext): RPCRequest =
    addQueryStringOptional("token", tc.userTokenOpt)

  def addHttpHeaders(hdrs: (String, String)*): RPCRequest = {
    request = request.addHttpHeaders(hdrs: _*)
    this
  }

  def withBasicAuth(username: String, password: String): RPCRequest = {
    request = request.withAuth(username, password, WSAuthScheme.BASIC)
    this
  }

  def withBasicAuthOpt(usernameOpt: Option[String], passwordOpt: Option[String]): RPCRequest = {
    (usernameOpt, passwordOpt) match {
      case (Some(username), Some(password)) => request = request.withAuth(username, password, WSAuthScheme.BASIC)
      case _                                => ()
    }
    this
  }

  def withSlowRequestLoggingThreshold(slowRequestLoggingThreshold: FiniteDuration): RPCRequest = {
    this.slowRequestLoggingThreshold = slowRequestLoggingThreshold
    this
  }

  def withLongTimeout: RPCRequest = {
    request = request.withRequestTimeout(2 hours)
    this
  }

  def silent: RPCRequest = {
    verbose = false
    this
  }

  def silentIf(condition: Boolean): RPCRequest = {
    if (condition) {
      verbose = false
    }
    this
  }

  def addQueryStringOptional(key: String, valueOptional: Option[String]): RPCRequest = {
    valueOptional match {
      case Some(value: String) => request = request.addQueryStringParameters((key, value))
      case _                   =>
    }
    this
  }

  def get: Fox[WSResponse] = {
    request = request.withMethod("GET")
    performRequest
  }

  def head: Fox[WSResponse] = {
    request = request.withMethod("HEAD")
    performRequest
  }

  def getWithJsonResponse[T: Reads]: Fox[T] = {
    request = request.withMethod("GET")
    parseJsonResponse(performRequest)
  }

  def getWithProtoResponse[T <: GeneratedMessage](companion: GeneratedMessageCompanion[T]): Fox[T] = {
    request = request.withMethod("GET")
    parseProtoResponse(performRequest)(companion)
  }

  def getWithBytesResponse: Fox[Array[Byte]] = {
    request = request.withMethod("GET")
    extractBytesResponse(performRequest)
  }

  def postEmpty(): Fox[Unit] = {
    request = request.withMethod("POST")
    performRequest.map(_ => ())
  }

  def postEmptyWithJsonResponse[T: Reads](): Fox[T] = {
    request = request.withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postEmptyWithProtoResponse[T <: GeneratedMessage]()(companion: GeneratedMessageCompanion[T]): Fox[T] = {
    request = request.withMethod("POST")
    parseProtoResponse(performRequest)(companion)
  }

  def postFile(file: File): Fox[WSResponse] = {
    request = request.withBody(file).withMethod("POST")
    performRequest
  }

  def postFormWithJsonResponse[T: Reads](parameters: Map[String, String]): Fox[T] = {
    request = request.withBody(parameters).withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postJson[T: Writes](body: T): Fox[WSResponse] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    performRequest
  }

  def postJsonWithJsonResponse[T: Writes, U: Reads](body: T): Fox[U] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postJsonWithBytesResponse[T: Writes](body: T): Fox[Array[Byte]] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    extractBytesResponse(performRequest)
  }

  def postJsonWithProtoResponse[J: Writes, T <: GeneratedMessage](body: J)(
      companion: GeneratedMessageCompanion[T]): Fox[T] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    parseProtoResponse(performRequest)(companion)
  }

  def postBytesWithBytesResponse(body: Array[Byte]): Fox[Array[Byte]] = {
    request = request.withBody(body).withMethod("POST")
    extractBytesResponse(performRequest)
  }

  def postProto[T <: GeneratedMessage](body: T): Fox[Unit] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> protobufMimeType).withBody(body.toByteArray).withMethod("POST")
    performRequest.map(_ => ())
  }

  def postProtoWithJsonResponse[T <: GeneratedMessage, J: Reads](body: T): Fox[J] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> protobufMimeType).withBody(body.toByteArray).withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postProtoWithProtoResponse[T <: GeneratedMessage, J <: GeneratedMessage](body: T)(
      companion: GeneratedMessageCompanion[J]): Fox[J] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> protobufMimeType).withBody(body.toByteArray).withMethod("POST")
    parseProtoResponse(performRequest)(companion)
  }

  def putJson[T: Writes](body: T): Fox[WSResponse] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("PUT")
    performRequest
  }

  def patchJson[T: Writes](body: T): Fox[WSResponse] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("PATCH")
    performRequest
  }

  def delete(): Fox[WSResponse] = {
    request = request.withMethod("DELETE")
    performRequest
  }

  private def performRequest: Fox[WSResponse] = Fox.futureBox2Fox {
    val before = Instant.now
    if (verbose) {
      logger.debug(s"Sending $debugInfo, RequestBody: '$requestBodyPreview'")
    }
    request
      .execute()
      .map { result =>
        val duration = Instant.since(before)
        val logSlow = verbose && duration > slowRequestLoggingThreshold
        if (Status.isSuccessful(result.status)) {
          if (logSlow) logger.info(f"Slow $debugInfo took ${formatDuration(duration)})}")
          Full(result)
        } else {
          val responseBodyPreview = result.bodyAsBytes.utf8String.take(2000)
          val durationLabel = if (logSlow) s" Duration: ${formatDuration(duration)}."
          val verboseErrorMsg =
            s"Failed $debugInfo," +
              s" Status: ${result.status}.$durationLabel" +
              s" RequestBody: '$requestBodyPreview'" +
              s" ResponseBody: '$responseBodyPreview'"
          logger.error(verboseErrorMsg)
          val compactErrorMsg =
            s"Failed $debugInfo. Response: ${result.status} '$responseBodyPreview'"
          Failure(compactErrorMsg)
        }
      }
      .recover {
        case e =>
          val errorMsg = s"Error sending $debugInfo: " +
            s"${e.getMessage}\n${e.getStackTrace.mkString("\n    ")}"
          logger.error(errorMsg)
          Failure(errorMsg)
      }
  }

  private def extractBytesResponse(r: Fox[WSResponse]): Fox[Array[Byte]] =
    r.flatMap { response =>
      val responseBytes = response.bodyAsBytes
      if (verbose) {
        logger.debug(s"Successful $debugInfo. ResponseBody: <${responseBytes.length} raw bytes>")
      }
      Fox.successful(responseBytes.toArray)
    }

  private def parseJsonResponse[T: Reads](r: Fox[WSResponse]): Fox[T] =
    r.flatMap { response =>
      if (verbose) {
        logger.debug(s"Successful $debugInfo. ResponseBody: '${response.body.take(100)}'")
      }
      Json.parse(response.body).validate[T] match {
        case JsSuccess(value, _) =>
          Fox.successful(value)
        case JsError(e) =>
          val errorMsg = s"$debugInfo returned invalid JSON: $e"
          logger.error(errorMsg)
          Fox.failure(errorMsg)
      }
    }

  private def parseProtoResponse[T <: GeneratedMessage](r: Fox[WSResponse])(companion: GeneratedMessageCompanion[T]) =
    r.flatMap { response =>
      if (verbose) {
        logger.debug(s"Successful $debugInfo, ResponseBody: <${response.body.length} bytes of protobuf data>")
      }
      try {
        Fox.successful(companion.parseFrom(response.bodyAsBytes.toArray))
      } catch {
        case e: Exception =>
          val errorMsg = s"$debugInfo returned invalid Protocol Buffer Data: $e"
          logger.error(errorMsg)
          Fox.failure(errorMsg)
      }
    }

  private def debugInfo: String = f"RPC $id: ${request.method} $url"

  private def requestBodyPreview: String =
    request.body match {
      case body: InMemoryBody
          if request.headers.getOrElse(HeaderNames.CONTENT_TYPE, List()).contains(protobufMimeType) =>
        s"<${body.bytes.length} bytes of protobuf data>"
      case body: InMemoryBody
          if request.headers.getOrElse(HeaderNames.CONTENT_TYPE, List()).contains(octetStreamMimeType) =>
        s"<${body.bytes.length} raw bytes>"
      case body: InMemoryBody =>
        body.bytes.take(100).utf8String + (if (body.bytes.size > 100) s"... <omitted ${body.bytes.size - 100} bytes>"
                                           else "")
      case _: SourceBody =>
        s"<streaming source>"
      case _ =>
        ""
    }
}
