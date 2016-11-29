/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import play.api.libs.json.{JsError, JsValue, Json}
import com.scalableminds.braingames.binary.models.{DataLayer, DataSourceLike}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.http.HeaderNames
import akka.actor.{ActorSystem, Props}
import com.scalableminds.util.rest.RESTCall
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.ws.WS
import play.api.mvc._
import play.api.test.Helpers.{route, _}
import play.api.test.{FakeHeaders, FakeRequest}
import play.api.mvc.AnyContentAsJson
import play.api.libs.json.JsSuccess
import play.api.libs.iteratee.Iteratee
import play.api.Play.current
import play.utils.UriEncoding

import scala.concurrent.Future
import net.liftweb.common.{Failure, Full}
import org.apache.commons.codec.binary.Base64

class OxalisMessageHandler extends JsonMessageHandler with LazyLogging {

  def queryStringToString(queryStrings: Map[String, String]) =
    queryStrings.map( t => t._1 + "=" + t._2).mkString("?", "&", "")

  def requestFromRESTCall[T](call: RESTCall)(implicit codec: Codec): Option[Future[Result]] = {
    val path = call.path + queryStringToString(call.queryStrings)

    call.method match {
      case "FILE" =>
        val fileContent = (call.body \ "file")
          .asOpt[Array[Byte]].map(f => Base64.decodeBase64(f))
          .getOrElse(Array.empty)
        val request = FakeRequest("POST", path, FakeHeaders(call.headers.toSeq),
          AnyContentAsRaw(RawBuffer(fileContent.length, fileContent)))
        route(request)
      case standardMethod =>
        val request = FakeRequest(standardMethod, path, FakeHeaders(call.headers.toSeq),
          AnyContentAsJson(call.body))
        route(request)
    }
  }

  def embedInRESTResponse(call: RESTCall, response: Result)(implicit codec: Codec): Future[Array[Byte]] = {

    val headers = Json.stringify(Json.toJson(response.header.headers))

    def wrappIt(data: Array[Byte]): Array[Byte] = {
      val head = s"""
          |{
          |  "uuid" : "${call.uuid}",
          |  "status": "${response.header.status}",
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
    logger.trace("About to handle WS REST call. Json: " + js)
    js.validate(RESTCall.restCallFormat) match {
      case JsSuccess(call, _) =>
        requestFromRESTCall(call) match {
          case Some(f) =>
            logger.trace(s"Got a handler for WS REST request '${call.uuid}'. ")
            f.flatMap { response =>
              logger.trace(s"Rerouted WS REST request '${call.uuid}' finished.")
              embedInRESTResponse(call, response).map(Right(_))
            }
          case None =>
            logger.warn(s"Couldn't find handler for WS REST request '${call.uuid}'")
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
  webSocketSecurityInfo: WSSecurityInfo)(implicit system: ActorSystem) extends FoxImplicits with LazyLogging {

  val webSocketPath = s"/api/datastores/$name/backchannel?key=$key"

  val webSocketUrl = (if (webSocketSecurityInfo.secured) "wss://" else "ws://") + url + webSocketPath

  val httpUrl = (if (webSocketSecurityInfo.secured) "https://" else "http://") + url

  val webSocket = system.actorOf(Props(new JsonWSTunnel(webSocketUrl, new OxalisMessageHandler, webSocketSecurityInfo)))

  def dataSourceNameToURL(dataSourceName: String) =
    UriEncoding.encodePathSegment(dataSourceName, "UTF-8")
  
  def oxalisWS(path: String) = {
    WS.url(s"$httpUrl$path")
      .withQueryString("key" -> key)
      .withHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
  }

  def reportDataSources(dataSources: List[DataSourceLike]) = {
    logger.trace("reporting datasources " + dataSources.map(d => d.id + s" (${if(d.isUsable) "active" else "inactive"}})").mkString(", "))
    oxalisWS(s"/api/datastores/$name/datasources")
      .post(Json.toJson(dataSources))
      .map {

      result =>
        if (result.status != OK)
          logger.warn(s"Reporting found data sources to oxalis failed. Status ${result.status}. Body: '${result.body.take(100)}'")
        logger.trace(s"result of reporting datasources: code: ${result.statusText}\nbody: ${result.body}")
    }.recover{
      case er => logger.error(s"Error reporting the datasets: ${er.getMessage}\n${er.getStackTrace.mkString("\n    ")}")
    }
  }

  def reportDataSouce(dataSource: DataSourceLike) = {
    oxalisWS(s"/api/datastores/$name/datasources/${dataSourceNameToURL(dataSource.id)}")
      .post(Json.toJson(dataSource))
      .map {
      result =>
        if (result.status != OK)
          logger.warn(s"Reporting data source update to oxalis failed. Status ${result.status}. Body: '${result.body.take(100)}'")
    }
  }

  def requestUserDataLayer(dataSetName: String, dataLayerName: String): Fox[DataLayer] = {
    oxalisWS(s"/api/datastores/$name/datasources/${dataSourceNameToURL(dataSetName)}/layers/$dataLayerName")
      .get()
      .map {
      result =>
        logger.trace(s"Querying user data layer. Status: '${result.status}'")
        if(result.status == OK)
          result.json.validate(DataLayer.dataLayerFormat) match {
            case JsSuccess(dataLayer, _) => Full(dataLayer)
            case e: JsError => Failure("Invalid json result from data layer query: " + e.toString)
          }
        else
          Failure(s"Couldn't request user data layer. Status ${result.status}. Body: '${result.body.take(100)}'")
    }
  }

  def requestUserAccess(token: String, dataSetName: String, dataLayerName: String) = {
    oxalisWS(s"/api/dataToken/validate")
      .withQueryString(
        "token" -> token,
        "dataSetName" -> dataSetName,
        "dataLayerName" -> dataLayerName)
      .get()
      .map {
      result =>
        logger.trace(s"Querying dataToken validity: ${token}. Status: '${result.status}'")
        result.status == OK
    }
  }

  def requestDataSetAccess(token: String, dataSetName: String) = {
    oxalisWS(s"/api/datasetToken/validate")
      .withQueryString(
        "token" -> token,
        "dataSetName" -> dataSetName)
      .get()
      .map {
      result =>
        logger.trace(s"Querying dataset token validity: $token. Status: '${result.status}'")
        result.status == OK
    }
  }
}
