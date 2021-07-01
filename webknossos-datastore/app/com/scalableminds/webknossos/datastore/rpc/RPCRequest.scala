package com.scalableminds.webknossos.datastore.rpc

import java.io.File

import akka.stream.scaladsl.Source
import akka.util.ByteString
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import play.api.http.{HeaderNames, Status}
import play.api.libs.json._
import play.api.libs.ws._
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

class RPCRequest(val id: Int, val url: String, wsClient: WSClient) extends FoxImplicits with LazyLogging {

  var request: WSRequest = wsClient.url(url)
  private var verbose: Boolean = true

  def addQueryString(parameters: (String, String)*): RPCRequest = {
    request = request.addQueryStringParameters(parameters: _*)
    this
  }

  def withBasicAuth(username: String, password: String): RPCRequest = {
    request = request.withAuth(username, password, WSAuthScheme.BASIC)
    this
  }

  def silent: RPCRequest = {
    verbose = false
    this
  }

  def addQueryStringOptional(key: String, valueOptional: Option[String]): RPCRequest = {
    valueOptional match {
      case Some(value: String) => request = request.addQueryStringParameters((key, value))
      case _                   =>
    }
    this
  }

  def addHeader(header: (String, String)) = {
    request = request.addHttpHeaders(header)
    this
  }

  def get: Fox[WSResponse] = {
    request = request.withMethod("GET")
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
    request = request.withMethod("GET").withRequestTimeout(30 minutes)
    extractBytesResponse(performRequest)
  }

  def post(file: File): Fox[WSResponse] = {
    request = request.withBody(file).withMethod("POST")
    performRequest
  }

  def postWithJsonResponse[T: Reads](file: File): Fox[T] = {
    request = request.withBody(file).withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postWithProtoResponse[T <: GeneratedMessage](file: File)(companion: GeneratedMessageCompanion[T]): Fox[T] = {
    request = request.withBody(file).withMethod("POST")
    parseProtoResponse(performRequest)(companion)
  }

  def post[T: Writes](body: T = Json.obj()): Fox[WSResponse] = {
    request = request
      .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
      .withBody(Json.toJson(body))
      .withMethod("POST")
    performRequest
  }

  def put[T: Writes](body: T = Json.obj()): Fox[WSResponse] = {
    request = request
      .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
      .withBody(Json.toJson(body))
      .withMethod("PUT")
    performRequest
  }

  def patch[T: Writes](body: T = Json.obj()): Fox[WSResponse] = {
    request = request
      .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
      .withBody(Json.toJson(body))
      .withMethod("PATCH")
    performRequest
  }

  def postWithJsonResponse[T: Writes, U: Reads](body: T = Json.obj()): Fox[U] = {
    request = request
      .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
      .withBody(Json.toJson(body))
      .withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postJsonWithProtoResponse[J: Writes, T <: GeneratedMessage](body: J = Json.obj())(
      companion: GeneratedMessageCompanion[T]): Fox[T] = {
    request = request
      .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
      .withBody(Json.toJson(body))
      .withMethod("POST")
    parseProtoResponse(performRequest)(companion)
  }

  def postJson[J: Writes](body: J = Json.obj()): Unit = {
    request = request
      .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
      .withBody(Json.toJson(body))
      .withMethod("POST")
    performRequest
  }

  def postProtoWithJsonResponse[T <: GeneratedMessage, J: Reads](body: T): Fox[J] = {
    request = request
      .addHttpHeaders(HeaderNames.CONTENT_TYPE -> "application/x-protobuf")
      .withBody(body.toByteArray)
      .withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def getStream: Fox[Source[ByteString, _]] = {
    if (verbose) {
      logger.debug(
        s"Sending WS request to $url (ID: $id). " +
          s"RequestBody: '$requestBodyPreview'")
    }
    request
      .withMethod("GET")
      .withRequestTimeout(Duration.Inf)
      .stream()
      .map(response => Full(response.bodyAsSource))
      .recover {
        case e =>
          val errorMsg = s"Error sending WS request to $url (ID: $id): " +
            s"${e.getMessage}\n${e.getStackTrace.mkString("\n    ")}"
          logger.error(errorMsg)
          Failure(errorMsg)
      }
  }

  private def performRequest: Fox[WSResponse] = {
    if (verbose) {
      logger.debug(
        s"Sending WS request to $url (ID: $id). " +
          s"RequestBody: '$requestBodyPreview'")
    }
    request
      .execute()
      .map { result =>
        if (Status.isSuccessful(result.status)) {
          Full(result)
        } else {
          val errorMsg = s"Unsuccessful WS request to $url (ID: $id)." +
            s"Status: ${result.status}. Response: ${result.bodyAsBytes.map(_.toChar).mkString.take(2000)}"
          logger.error(errorMsg)
          Failure(errorMsg.take(400))
        }
      }
      .recover {
        case e =>
          val errorMsg = s"Error sending WS request to $url (ID: $id): " +
            s"${e.getMessage}\n${e.getStackTrace.mkString("\n    ")}"
          logger.error(errorMsg)
          Failure(errorMsg)
      }
  }

  private def extractBytesResponse(r: Fox[WSResponse]): Fox[Array[Byte]] =
    r.flatMap { response =>
      if (Status.isSuccessful(response.status)) {
        val responseBytes = response.bodyAsBytes
        if (verbose) {
          logger.debug(
            s"Successful request (ID: $id). " +
              s"Body: '<${responseBytes.length} raw bytes>'")
        }
        Fox.successful(responseBytes.toArray)
      } else {
        logger.error(
          s"Failed to send WS request to $url (ID: $id). " +
            s"RequestBody: '$requestBodyPreview'. Status ${response.status}. " +
            s"ResponseBody: '${response.body.take(100)}'")
        Fox.failure("Unsuccessful WS request to $url (ID: $id)")
      }
    }

  private def parseJsonResponse[T: Reads](r: Fox[WSResponse]): Fox[T] =
    r.flatMap { response =>
      if (Status.isSuccessful(response.status)) {
        if (verbose) {
          logger.debug(
            s"Successful request (ID: $id). " +
              s"Body: '${response.body.take(100)}'")
        }
      } else {
        logger.error(
          s"Failed to send WS request to $url (ID: $id). " +
            s"RequestBody: '$requestBodyPreview'. Status ${response.status}. " +
            s"ResponseBody: '${response.body.take(100)}'")
      }
      Json.parse(response.body).validate[T] match {
        case JsSuccess(value, _) =>
          Full(value)
        case JsError(e) =>
          val errorMsg = s"Request returned invalid JSON (ID: $id): $e"
          logger.error(errorMsg)
          Failure(errorMsg)
      }
    }

  private def parseProtoResponse[T <: GeneratedMessage](r: Fox[WSResponse])(companion: GeneratedMessageCompanion[T]) =
    r.flatMap { response =>
      if (Status.isSuccessful(response.status)) {
        if (verbose) {
          logger.debug(
            s"Successful request (ID: $id). " +
              s"Body: <${response.body.length} bytes of protobuf data>")
        }
      } else {
        logger.error(
          s"Failed to send WS request to $url (ID: $id). " +
            s"RequestBody: '$requestBodyPreview'. Status ${response.status}. " +
            s"ResponseBody: '${response.body.take(100)}'")
      }
      try {
        Full(companion.parseFrom(response.bodyAsBytes.toArray))
      } catch {
        case e: Exception =>
          val errorMsg = s"Request returned invalid Protocol Buffer Data (ID: $id): $e"
          logger.error(errorMsg)
          Failure(errorMsg)
      }
    }

  private def requestBodyPreview: String =
    request.body match {
      case body: InMemoryBody
          if request.headers.getOrElse(HeaderNames.CONTENT_TYPE, List()).contains("application/x-protobuf") =>
        s"<${body.bytes.length} bytes of protobuf data>"
      case body: InMemoryBody =>
        body.bytes.take(100).utf8String + (if (body.bytes.size > 100) s"... <omitted ${body.bytes.size - 100} bytes>"
                                           else "")
      case _: SourceBody =>
        s"<streaming source>"
      case _ =>
        ""
    }
}
