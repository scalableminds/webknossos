/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import akka.actor.ActorSystem
import com.scalableminds.braingames.binary.models.{DataLayer, DataSourceLike}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import play.api.Play.current
import play.api.http.HeaderNames
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.libs.ws.WS
import play.api.test.Helpers._
import play.utils.UriEncoding

import scala.concurrent.Future

class OxalisServer(
                    url: String,
                    key: String,
                    name: String,
                    isSecured: Boolean)(implicit system: ActorSystem)
  extends FoxImplicits
    with LazyLogging {

  private val httpUrl = httpUrlPrefix + url

  private def httpUrlPrefix = if (isSecured) "https://" else "http://"

  private def dataSourceNameToURL(dataSourceName: String) =
    UriEncoding.encodePathSegment(dataSourceName, "UTF-8")

  private def oxalisWS(path: String) = {
    WS.url(s"$httpUrl$path")
      .withQueryString("key" -> key)
      .withHeaders(HeaderNames.CONTENT_TYPE -> "application/json")
  }

  def reportStatus(ok: Boolean, url: String): Future[Unit] = {
    oxalisWS(s"/api/datastores/$name/status")
      .post(Json.obj("ok" -> ok, "url" -> url))
      .map { result =>
        if (result.status != OK)
          logger.warn(s"Failed to send updated status to oxalis. " +
            s"Status ${result.status}. Body: '${result.body.take(100)}'")
      }
      .recover { case er =>
        logger.error(s"Error reporting status: " +
          s"${er.getMessage}\n${er.getStackTrace.mkString("\n    ")}")
      }
  }

  def reportDataSources(dataSources: List[DataSourceLike]): Future[Unit] = {
    logger.trace("reporting datasources " +
      dataSources.map(d => d.id + s" (${if (d.isUsable) "active" else "inactive"}})").mkString(", "))
    oxalisWS(s"/api/datastores/$name/datasources")
      .post(Json.toJson(dataSources))
      .map { result =>
        if (result.status != OK)
          logger.warn(s"Reporting found data sources to oxalis failed. " +
            s"Status ${result.status}. Body: '${result.body.take(100)}'")
        logger.trace(s"result of reporting datasources: code: " +
          s"${result.statusText}\nbody: ${result.body}")
      }.recover {
      case er =>
        logger.error(s"Error reporting the datasets: " +
          s"${er.getMessage}\n${er.getStackTrace.mkString("\n    ")}")
    }
  }

  def reportDataSouce(dataSource: DataSourceLike): Future[Unit] = {
    oxalisWS(s"/api/datastores/$name/datasources/${dataSourceNameToURL(dataSource.id)}")
      .post(Json.toJson(dataSource))
      .map {
        result =>
          if (result.status != OK)
            logger.warn(s"Reporting data source update to oxalis failed. " +
              s"Status ${result.status}. Body: '${result.body.take(100)}'")
      }
  }

  def requestUserDataLayer(dataSetName: String, dataLayerName: String): Fox[DataLayer] = {
    oxalisWS(s"/api/datastores/$name/datasources/${dataSourceNameToURL(dataSetName)}/layers/$dataLayerName")
      .get()
      .map {
        result =>
          logger.trace(s"Querying user data layer. Status: '${result.status}'")
          if (result.status == OK)
            result.json.validate(DataLayer.dataLayerFormat) match {
              case JsSuccess(dataLayer, _) => Full(dataLayer)
              case e: JsError => Failure("Invalid json result from data layer query: " + e.toString)
            }
          else
            Failure(s"Couldn't request user data layer. " +
              s"Status ${result.status}. Body: '${result.body.take(100)}'")
      }
  }

  def validateDSUpload(token: String, dataSetName: String, team: String): Fox[Boolean] = {
    oxalisWS(s"/api/datastores/$name/verifyUpload")
      .withQueryString(
        "token" -> token)
      .post(Json.obj("name" -> dataSetName, "team" -> team))
      .map {
        result =>
          logger.trace(s"Querying user access: $token. Status: '${result.status}'")
          result.status match {
            case OK => Full(true)
            case _ => Failure(result.body)
          }
      }
  }

  def requestUserAccess(token: String, dataSetName: String, dataLayerName: String): Future[Boolean] = {
    oxalisWS(s"/api/dataToken/validate")
      .withQueryString(
        "token" -> token,
        "dataSetName" -> dataSetName,
        "dataLayerName" -> dataLayerName)
      .get()
      .map {
        result =>
          logger.trace(s"Querying dataToken validity: $token. Status: '${result.status}'")
          result.status == OK
      }
  }

  def requestDataSetAccess(token: String, dataSetName: String): Future[Boolean] = {
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
