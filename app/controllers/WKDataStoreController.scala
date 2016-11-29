/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import scala.concurrent.Future

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.FoxImplicits
import com.typesafe.scalalogging.LazyLogging
import models.binary._
import net.liftweb.common.Full
import oxalis.rest.WebSocketRESTServer
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.{Enumerator, Iteratee}
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.mvc.WebSocket.FrameFormatter
import play.api.mvc._

class WKDataStoreController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with WKDataStoreActionHelper
    with LazyLogging {

  def statusUpdate(name: String) = DataStoreAction(name).async(parse.json) { implicit request =>
    request.body.validate[DataStoreStatus] match {
      case JsSuccess(status, _) =>
        logger.debug(s"Status update from data store '$name'. Status: " + status.ok)
        DataStoreDAO.updateUrl(name, status.url)(GlobalAccessContext).map(_ => Ok)
      case e: JsError           =>
        logger.error("Data store '$name' sent invalid update. Error: " + e)
        Future.successful(JsonBadRequest(JsError.toFlatJson(e)))
    }
  }

  def backChannel(name: String, key: String) = WebSocket.tryAccept[Array[Byte]] { implicit request =>
    logger.trace(s"Got a back channel request for $name.")

    DataStoreDAO.findByKey(key)(GlobalAccessContext).futureBox.map {
      case Full(dataStore) =>
        val (iterator, enumerator, restChannel) = WebSocketRESTServer.create(dataStore.name)
        WKStoreHandlingStrategy.register(dataStore.name, restChannel)
        logger.info(s"Key ${dataStore.name} connected.")
        Right(iterator, enumerator)
      case _               =>
        logger.warn(s"$name tried to connect with invalid key '$key'.")
        Right(Iteratee.ignore[Array[Byte]], Enumerator.empty[Array[Byte]])
    }
  }(FrameFormatter.byteArrayFrame)

  def updateAll(name: String) = DataStoreAction(name)(parse.json) {
    implicit request =>
      request.body.validate[List[DataSourceLike]] match {
        case JsSuccess(dataSources, _) =>
          DataSetService.updateDataSources(request.dataStore, dataSources)(GlobalAccessContext)
          JsonOk
        case e: JsError                =>
          logger.warn("Data store reported invalid json for data sources.")
          JsonBadRequest(JsError.toFlatJson(e))
      }
  }

  def updateOne(name: String, dataSourceId: String) = DataStoreAction(name)(parse.json) { implicit request =>
    request.body.validate[DataSourceLike] match {
      case JsSuccess(dataSource, _) =>
        DataSetService.updateDataSources(request.dataStore, List(dataSource))(GlobalAccessContext)
        JsonOk
      case e: JsError               =>
        logger.warn("Data store reported invalid json for data source.")
        JsonBadRequest(JsError.toFlatJson(e))
    }
  }

  def layerRead(name: String, dsName: String, layerName: String) = DataStoreAction(name).async { implicit request =>
    for {
      ds <- DataSetDAO.findOneBySourceName(dsName)(GlobalAccessContext) ?~> Messages("dataSet.notFound", dsName)
      _ <- (ds.dataStoreInfo.name == request.dataStore.name) ?~> Messages("dataStore.notAllowed")
      layer <- DataSetService.getDataLayer(ds, layerName)(GlobalAccessContext) ?~> Messages("dataLayer.notFound", layerName)
    } yield {
      Ok(Json.toJson(layer))
    }
  }

}

trait WKDataStoreActionHelper extends FoxImplicits with Results with I18nSupport {

  import play.api.mvc._

  class RequestWithDataStore[A](val dataStore: DataStore, request: Request[A]) extends WrappedRequest[A](request)

  case class DataStoreAction(name: String) extends ActionBuilder[RequestWithDataStore] {
    def invokeBlock[A](request: Request[A], block: (RequestWithDataStore[A]) => Future[Result]): Future[Result] = {
      request.getQueryString("key")
      .toFox
      .flatMap(key => DataStoreDAO.findByKey(key)(GlobalAccessContext)) // Check if key is valid
      .filter(dataStore => dataStore.name == name) // Check if correct name is provided
      .flatMap(dataStore => block(new RequestWithDataStore(dataStore, request))) // Run underlying action
      .getOrElse(Forbidden(Messages("dataStore.notFound"))) // Default error
    }
  }

}
