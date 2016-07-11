/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import scala.concurrent.Future

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.binary._
import net.liftweb.common.Full
import oxalis.rest.WebSocketRESTServer
import play.api.Logger
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.{Enumerator, Iteratee}
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.mvc.WebSocket.FrameFormatter
import play.api.mvc._

class WKDataStoreController @Inject()(val messagesApi: MessagesApi) extends Controller with WKDataStoreActionHelper {

  def show = DataStoreAction { implicit request =>
    Ok(DataStore.dataStoreFormat.writes(request.dataStore))
  }

  def backChannel(name: String, key: String) = WebSocket.tryAccept[Array[Byte]] {
    implicit request =>
      Logger.info(s"Got a backchannel request for $name.")
      DataStoreDAO.findByKey(key)(GlobalAccessContext).futureBox.map {
        case Full(dataStore) =>
          val (iterator, enumerator, restChannel) = WebSocketRESTServer.create(name)
          WKStoreHandlingStrategy.register(dataStore.name, restChannel)
          Logger.info(s"Key $name connected.")
          Right(iterator, enumerator)
        case _               =>
          Logger.warn(s"$name  tried to connect with invalid key '$key'.")
          Right(Iteratee.ignore[Array[Byte]], Enumerator.empty[Array[Byte]])
      }
  }(FrameFormatter.byteArrayFrame)

  def updateAll(name: String) = DataStoreAction(parse.json) {
    implicit request =>
      request.body.validate[List[DataSourceLike]] match {
        case JsSuccess(dataSources, _) =>
          DataSetService.updateDataSources(request.dataStore, dataSources)(GlobalAccessContext)
          JsonOk
        case e: JsError                =>
          Logger.warn("Datastore reported invalid json for datasources.")
          JsonBadRequest(JsError.toFlatJson(e))
      }
  }

  def updateOne(name: String, dataSourceId: String) = DataStoreAction(parse.json) { implicit request =>
    request.body.validate[DataSourceLike] match {
      case JsSuccess(dataSource, _) =>
        DataSetService.updateDataSources(request.dataStore, List(dataSource))(GlobalAccessContext)
        JsonOk
      case e: JsError               =>
        Logger.warn("Datastore reported invalid json for datasource.")
        JsonBadRequest(JsError.toFlatJson(e))
    }
  }

  def layerRead(name: String, dataSetName: String, dataLayerName: String) = DataStoreAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)(GlobalAccessContext) ?~> Messages("dataSet.notFound", dataSetName)
      _ <- (dataSet.dataStoreInfo.name == request.dataStore.name) ?~> Messages("dataStore.notAllowed")
      layer <- DataSetService.getDataLayer(dataSet, dataLayerName)(GlobalAccessContext) ?~> Messages("dataLayer.notFound", dataLayerName)
    } yield {
      Ok(Json.toJson(layer))
    }
  }

}

trait WKDataStoreActionHelper extends FoxImplicits with Results with I18nSupport {

  import play.api.mvc._

  class RequestWithDataStore[A](val dataStore: DataStore, request: Request[A]) extends WrappedRequest[A](request)

  object DataStoreAction extends ActionBuilder[RequestWithDataStore] {
    def invokeBlock[A](request: Request[A], block: (RequestWithDataStore[A]) => Future[Result]) = {
      request.getQueryString("key").toFox.flatMap(key => DataStoreDAO.findByKey(key)(GlobalAccessContext)).flatMap {
        dataStore =>
          block(new RequestWithDataStore(dataStore, request))
      }.getOrElse(Forbidden(Messages("dataStore.notFound")))
    }
  }

}
