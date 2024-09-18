package com.scalableminds.webknossos.datastore.rpc

import com.scalableminds.util.mvc.MimeTypes
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import play.api.http.{HeaderNames, Status}
import play.api.libs.json._
import play.api.libs.ws._
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import java.io.File
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class RPCRequest(val id: Int, val url: String, wsClient: WSClient)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with MimeTypes {

  var request: WSRequest = wsClient.url(url)
  private var verbose: Boolean = true

  def addQueryString(parameters: (String, String)*): RPCRequest = {
    request = request.addQueryStringParameters(parameters: _*)
    this
  }

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

  def post(): Fox[WSResponse] = {
    request = request.withMethod("POST")
    performRequest
  }

  def post(file: File): Fox[WSResponse] = {
    request = request.withBody(file).withMethod("POST")
    performRequest
  }

  def postFormParseJson[T: Reads](parameters: Map[String, String]): Fox[T] = {
    request = request.withBody(parameters).withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postWithJsonResponse[T: Reads]: Fox[T] = {
    request = request.withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postJsonWithBytesResponse[T: Writes](body: T = Json.obj()): Fox[Array[Byte]] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    extractBytesResponse(performRequest)
  }

  def post[T: Writes](body: T = Json.obj()): Fox[WSResponse] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    performRequest
  }

  def postWithJsonResponse[TW: Writes, TR: Reads](body: TW = Json.obj()): Fox[TR] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def put[T: Writes](body: T = Json.obj()): Fox[WSResponse] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("PUT")
    performRequest
  }

  def patch[T: Writes](body: T = Json.obj()): Fox[WSResponse] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("PATCH")
    performRequest
  }

  def delete(): Fox[WSResponse] = {
    request = request.withMethod("DELETE")
    performRequest
  }

  def postJsonWithJsonResponse[T: Writes, U: Reads](body: T = Json.obj()): Fox[U] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    parseJsonResponse(performRequest)
  }

  def postBytesWithBytesResponse(body: Array[Byte]): Fox[Array[Byte]] = {
    request = request.withBody(body).withMethod("POST")
    extractBytesResponse(performRequest)
  }

  def postJsonWithProtoResponse[J: Writes, T <: GeneratedMessage](body: J = Json.obj())(
      companion: GeneratedMessageCompanion[T]): Fox[T] = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    parseProtoResponse(performRequest)(companion)
  }

  def postJson[J: Writes](body: J = Json.obj()): Unit = {
    request =
      request.addHttpHeaders(HeaderNames.CONTENT_TYPE -> jsonMimeType).withBody(Json.toJson(body)).withMethod("POST")
    performRequest
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
          if request.headers.getOrElse(HeaderNames.CONTENT_TYPE, List()).contains(protobufMimeType) =>
        s"<${body.bytes.length} bytes of protobuf data>"
      case body: InMemoryBody
          if request.headers.getOrElse(HeaderNames.CONTENT_TYPE, List()).contains(octetStreamMimeType) =>
        s"<${body.bytes.length} bytes of byte data>"
      case body: InMemoryBody =>
        body.bytes.take(100).utf8String + (if (body.bytes.size > 100) s"... <omitted ${body.bytes.size - 100} bytes>"
                                           else "")
      case _: SourceBody =>
        s"<streaming source>"
      case _ =>
        ""
    }
}
