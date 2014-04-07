/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import play.api.libs.json.{ JsError, Json, JsValue }
import braingames.binary.models.DataSourceLike
import play.api.libs.ws.WS
import braingames.binary.Logger._
import braingames.util.FoxImplicits
import play.api.libs.concurrent.Execution.Implicits._
import play.api.http.HeaderNames
import akka.actor.{ ActorSystem, Props }
import braingames.rest.RESTCall
import play.api.mvc._
import play.api.test.Helpers._
import play.api.test.{ FakeRequest, FakeHeaders }
import play.api.mvc.AnyContentAsJson
import play.api.libs.json.JsSuccess
import play.api.libs.iteratee.Iteratee
import scala.concurrent.Future
import java.io.File

class OxalisMessageHandler extends JsonMessageHandler {

  def requestFromRESTCall[T](call: RESTCall) =
    FakeRequest(call.method, call.path, FakeHeaders(call.headers.toList), AnyContentAsJson(call.body))

  def embedInRESTResponse(call: RESTCall, response: SimpleResult)(implicit codec: Codec): Future[Array[Byte]] = {

    val headers = Json.stringify(Json.toJson(response.header.headers))

    def wrappIt(data: Array[Byte]): Array[Byte] = {
      val head = s"""
          |{
          |  "uuid" : "${call.uuid}",
          |  "status": "200",
          |  "path" : "${call.path}",
          |  "headers" : $headers,
          |  "body" :
        """.stripMargin

      val tail = "}"

      Array.concat(codec.encode(head), data, codec.encode(tail))
    }
    response.body.run(Iteratee.consume[Array[Byte]]()).map {
      bytes =>
        wrappIt(bytes)
    }
  }

  def handle(js: JsValue): Future[Either[JsValue, Array[Byte]]] = {
    logger.info("About to handle WS REST call. Json: " + js)
    js.validate(RESTCall.restCallFormat) match {
      case JsSuccess(call, _) =>
        val request = requestFromRESTCall(call)
        route(request) match {
          case Some(f) =>
            logger.info(s"Got a handler for WS REST request '${call.uuid}'. ")
            f.flatMap {
              response: SimpleResult =>
                logger.info(s"Rerouted WS REST request '${call.uuid}' finished.")
                embedInRESTResponse(call, response).map(Right(_))
            }
          case None =>
            logger.warn(s"Unable to process WS REST request '${call.uuid}'")
            Future.successful(Left(Json.obj("error" -> "Handler is not able to process request.")))
        }
      case e: JsError =>
        logger.error(s"Unable to parse WS REST request. Error: " + e)
        Future.successful(Left(Json.obj("error" -> "Invalid WS REST request. ") ++ JsError.toFlatJson(e)))
    }
  }
}

class OxalisServer(
  url: String,
  key: String,
  name: String,
  webSocketSecurityInfo: WSSecurityInfo)(implicit system: ActorSystem) extends FoxImplicits {

  val webSocketPath = s"/api/datastores/$name/backchannel?key=$key"

  val webSocketUrl = (if (webSocketSecurityInfo.secured) "wss://" else "ws://") + url + webSocketPath

  val httpUrl = (if (webSocketSecurityInfo.secured) "https://" else "http://") + url

  val webSocket = system.actorOf(Props(new JsonWSTunnel(webSocketUrl, new OxalisMessageHandler, webSocketSecurityInfo)))

  def oxalisWS(path: String) = {
    WS.url(s"$httpUrl$path")
      .withQueryString("key" -> key)
      .withHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
  }

  def reportDataSouces(dataSources: List[DataSourceLike]) = {
    oxalisWS(s"/api/datastores/$name/datasources")
      .post(Json.toJson(dataSources))
      .map {
        result =>
          if (result.status != 200)
            logger.warn(s"Reporting found data sources to oxalis failed. Status ${result.status}. Body: '${result.body.take(100)}'")
      }
  }

  def reportDataSouce(dataSource: DataSourceLike) = {
    oxalisWS(s"/api/datastores/$name/datasources/${dataSource.id}")
      .post(Json.toJson(dataSource))
      .map {
        result =>
          if (result.status != 200)
            logger.warn(s"Reporting data source update to oxalis failed. Status ${result.status}. Body: '${result.body.take(100)}'")
      }
  }

  def ping() = {
    oxalisWS(s"/api/datastores/$name/ping")
      .get()
      .map {
        result =>
          if (result.status != 200)
            logger.warn(s"Pinging oxalis failed. Status ${result.status}. Body: '${result.body.take(100)}'")
      }
  }

  def requestUserAccess(token: String, dataSetName: String, dataLayerName: String) = {
    oxalisWS(s"/dataToken/validate")
      .withQueryString(
        "token" -> token,
        "dataSetName" -> dataSetName,
        "dataLayerName" -> dataLayerName)
      .get()
      .map {
        result =>
          logger.warn(s"Querying dataToken validity: ${token}. Status: '${result.status}'")
          result.status == 200
      }
  }
}
