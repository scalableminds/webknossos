/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import akka.agent.Agent
import play.api.mvc.{Codec, Action, WebSocket}
import play.api.libs.json.{JsError, JsSuccess, Json, JsValue}
import play.api.libs.iteratee.{Enumerator, Iteratee, Concurrent}
import play.api.libs.ws.WS.WSRequestHolder
import java.util.UUID
import scala.concurrent.{Future, Promise}
import net.liftweb.common.{Empty, Failure, Full, Box}
import play.api.libs.iteratee.Concurrent.Channel
import play.api.Logger
import play.api.libs.concurrent.Akka
import scala.concurrent.duration._
import braingames.util.{Fox, FoxImplicits}
import models.binary.{DataSet, DataStore, DataSetService, DataStoreDAO}
import play.api.i18n.Messages
import braingames.binary.models.{UsableDataSource, UserDataLayer, DataSource, DataSourceLike}
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import play.api.libs.ws.WS
import braingames.rest.{RESTResponse, RESTCall}

object DataStoreHandler extends DataStoreBackChannelHandler{
  def createUserDataSource(base: DataSource): Fox[UserDataLayer] = {
    // TODO: Implement
    Empty
  }

  def progressForImport(dataSet: DataSet): Fox[JsValue] = {
    Logger.info("Progress called for: " + dataSet.name)
    findByServer(dataSet.dataStoreInfo.name).toFox.flatMap {
      dataStore =>
        val call = RESTCall("GET", s"/data/datasets/${dataSet.name}/import", Map.empty, Map.empty, Json.obj())
        dataStore.request(call)
    }
  }

  def importDataSource(dataSet: DataSet): Fox[JsValue] = {
    Logger.info("Import called for: " + dataSet.name)
    findByServer(dataSet.dataStoreInfo.name).toFox.flatMap {
      dataStore =>
        val call = RESTCall("POST", s"/data/datasets/${dataSet.name}/import", Map.empty, Map.empty, Json.obj())
        dataStore.request(call)
    }
  }
}

trait DataStoreBackChannelHandler extends FoxImplicits {
  val dataStores = Agent[Map[String, WebSocketRESTServer]](Map.empty)

  def register(dataStoreName: String, restChannel: WebSocketRESTServer) = {
    dataStores.send(_ + (dataStoreName -> restChannel))
  }

  def unregister(dataStoreName: String) = {
    dataStores.send(_ - dataStoreName)
  }

  def findByServer(dataStoreName: String) = {
    dataStores().get(dataStoreName)
  }

  def sendRequest(dataStoreName: String, call: RESTCall) = {
    findByServer(dataStoreName).toFox.flatMap {
      restChannel =>
        restChannel.request(call)
    }
  }
}

object WebSocketRESTServer {
  def create() = {
    val (enumerator, channel) = Concurrent.broadcast[Array[Byte]]

    val ws = WebSocketRESTServer(channel)

    val iteratee = Iteratee.foreach[Array[Byte]] {
      it =>
        Logger.info("Got WS message: " + it.size)
        ws.response(it)
    }.map{ _ =>
      Logger.info("Websocket closed.")
    }
    (iteratee, enumerator, ws)
  }
}

case class WebSocketRESTServer(out: Channel[Array[Byte]]) extends FoxImplicits{
  protected implicit val system = Akka.system(play.api.Play.current)
  protected val openCalls = Agent[Map[String, Promise[Box[JsValue]]]](Map.empty)

  protected val RESTCallTimeout = 5 minutes

  def request(call: RESTCall)(implicit codec: Codec): Fox[JsValue] = {
    try{
      val promise = Promise[Box[JsValue]]()
      openCalls.send(_ + (call.uuid -> promise))
      Logger.info(s"About to send WS REST call to '${call.path}'")
      val data: Array[Byte] = codec.encode(Json.stringify(RESTCall.restCallFormat.writes(call)))
      out.push(data)
      system.scheduler.scheduleOnce(RESTCallTimeout)(cancelRESTCall(call.uuid))
      promise.future
    } catch {
      case e: Exception =>
        Logger.error("WS exception: " + e)
        Fox.failure("WS exception. " + e.getMessage, Full(e))
    }
  }

  def cancelRESTCall(uuid: String) = {
    openCalls().get(uuid).map {
      promise =>
        promise.trySuccess(Failure("REST call timed out.")) match {
          case true =>
            Logger.warn("REST request timed out. UUID: " + uuid)
          case false =>
            Logger.debug("REST request couldn't get completed. UUID: " + uuid)
        }
    }
  }

  def response(rawJson: Array[Byte]) = {
    try {
      Json.parse(rawJson).validate[RESTResponse] match {
        case JsSuccess(response, _) =>
          Logger.warn("Finished with REST result: " + response)
          openCalls().get(response.uuid).map {
            promise =>
              promise.trySuccess(Full(response.body)) match {
                case true =>
                  Logger.debug("REST request completed. UUID: " + response.uuid)
                case false =>
                  Logger.warn("REST request timed out. UUID: " + response.uuid)
              }
          }
        case e: JsError =>
          Logger.warn("Invalid REST result: " + JsError.toFlatJson(e))
      }
    }catch {
      case e: Exception =>
        Logger.error("Got invalid WS message: " + e.getMessage, e)
        Logger.error(s"Message as String: '${Codec.utf_8.decode(rawJson)}'")
    }
  }
}

object DataStoreController extends Controller {

  def show(key: String) = Action.async{ implicit request =>
      for {
        dataStore <- DataStoreDAO.findByKey(key)(GlobalAccessContext) ?~> Messages("dataStore.notFound")
      } yield {
        Ok(DataStore.dataStoreFormat.writes(dataStore))
      }
  }

  def ping(name: String, key: String) = Action.async{ implicit request =>
    for {
      dataStore <- DataStoreDAO.findByKey(key)(GlobalAccessContext) ?~> Messages("dataStore.notFound")
    } yield {
      Ok
    }
  }

  def backChannel(name: String, key: String) = WebSocket.async[Array[Byte]] {
    implicit request =>
      Logger.debug(s"Got a backchannel request for $name.")
      DataStoreDAO.findByKey(key)(GlobalAccessContext).futureBox.map {
        case Full(dataStore) =>
          val (iterator, enumerator, restChannel) = WebSocketRESTServer.create
          DataStoreHandler.register(dataStore.name, restChannel)
          // TODO: key logging needs to be removed
          Logger.debug(s"Key $name connected.")
          (iterator, enumerator)
        case _ =>
          Logger.warn(s"$name  tried to connect with invalid key '$key'.")
          (Iteratee.ignore[Array[Byte]], Enumerator.empty[Array[Byte]])
      }
  }

  def updateAll(name: String, key: String) = Action.async(parse.json) {
    implicit request =>
      for {
        dataStore <- DataStoreDAO.findByKey(key)(GlobalAccessContext) ?~> Messages("dataStore.notFound")
      } yield {
        request.body.validate[List[DataSourceLike]] match {
          case JsSuccess(dataSources, _) =>
            DataSetService.updateDataSources(dataStore.name, dataSources)(GlobalAccessContext)
            JsonOk
          case e: JsError =>
            Logger.warn("Datastore reported invalid json for datasources.")
            JsonBadRequest(JsError.toFlatJson(e))
        }
      }
  }

  def updateOne(name: String, dataSourceId: String, key: String) = Action.async(parse.json) {
    implicit request =>
      for {
        dataStore <- DataStoreDAO.findByKey(key)(GlobalAccessContext) ?~> Messages("dataStore.notFound")
      } yield {
        request.body.validate[DataSourceLike] match {
          case JsSuccess(dataSource, _) =>
            DataSetService.updateDataSources(dataStore.name, List(dataSource))(GlobalAccessContext)
            JsonOk
          case e: JsError =>
            Logger.warn("Datastore reported invalid json for datasource.")
            JsonBadRequest(JsError.toFlatJson(e))
        }
      }
  }
}
