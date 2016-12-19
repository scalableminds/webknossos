/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.rest

import scala.concurrent.Promise

import akka.agent.Agent
import com.scalableminds.util.rest.{RESTCall, RESTResponse}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import scala.concurrent.duration._

import akka.actor.ActorSystem
import net.liftweb.common.{Box, Failure, Full}
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status
import play.api.libs.concurrent.Akka
import play.api.libs.iteratee.Concurrent.Channel
import play.api.libs.iteratee.{Concurrent, Iteratee}
import play.api.libs.json.{JsError, JsSuccess, Json}
import play.api.mvc.Codec
import play.api.libs.concurrent.Execution.Implicits._

object WebSocketRESTServer extends LazyLogging {
  def create(name: String) = {
    val (enumerator, channel) = Concurrent.broadcast[Array[Byte]]

    val ws = WebSocketRESTServer(channel)

    val iteratee = Iteratee.foreach[Array[Byte]] {
      it =>
        logger.trace("Got WS message: " + it.length)
        ws.response(it)
    }.map{ _ =>
      logger.info(s"Websocket to '$name' closed. ")
    }
    (iteratee, enumerator, ws)
  }
}

case class WebSocketRESTServer(out: Channel[Array[Byte]])
  extends FoxImplicits
    with LazyLogging {

  protected implicit val system: ActorSystem = Akka.system(play.api.Play.current)

  protected val openCalls = Agent[Map[String, Promise[Box[RESTResponse]]]](Map.empty)

  protected val RESTCallTimeout = 5.minutes

  def request(call: RESTCall)(implicit codec: Codec): Fox[RESTResponse] = {
    try{
      val promise = Promise[Box[RESTResponse]]()
      openCalls.send(_ + (call.uuid -> promise))
      logger.trace(s"About to send WS REST call to '${call.method} ${call.path}'")
      val data: Array[Byte] = codec.encode(Json.stringify(RESTCall.restCallFormat.writes(call)))
      out.push(data)
      system.scheduler.scheduleOnce(RESTCallTimeout)(cancelRESTCall(call.uuid))
      promise.future
    } catch {
      case e: Exception =>
        logger.error("WS exception: " + e)
        Fox.failure("WS exception. " + e.getMessage, Full(e))
    }
  }

  def cancelRESTCall(uuid: String) = {
    openCalls().get(uuid).foreach {
      promise =>
        if(promise.trySuccess(Failure("REST call timed out.")))
          logger.warn("REST request timed out. UUID: " + uuid)
        openCalls.send(_ - uuid)
    }
  }

  def response(rawJson: Array[Byte]) = {
    try {
      val json = Json.parse(rawJson)
      json.validate[RESTResponse] match {
        case JsSuccess(response, _) =>
          if(response.status != Status.OK.toString) {
            val log: String => Unit =
              if(response.status != Status.NOT_FOUND.toString) logger.warn(_)
              else logger.debug(_)

            log(
              s"Failed (Code: ${response.status})  REST call to '${response.path}'(${response.uuid}). " +
              s"Result: '${response.body.toString().take(500)}'")
          }
          openCalls().get(response.uuid).foreach {
            promise =>
              promise.trySuccess(Full(response)) match {
                case true =>
                  logger.trace("REST request completed. UUID: " + response.uuid)
                case false =>
                  logger.warn("REST response was to slow. UUID: " + response.uuid)
              }
              openCalls.send(_ - response.uuid)
          }
        case _ if (json \ "ping").asOpt[String].isDefined =>
          logger.trace("Received a ping.")
        case e: JsError =>
          logger.warn("Invalid REST result: " + JsError.toFlatJson(e))
      }
    }catch {
      case e: Exception =>
        logger.error("Got invalid WS message: " + e.getMessage, e)
        logger.error(s"Message as String: '${Codec.utf_8.decode(rawJson)}'")
    }
  }
}
