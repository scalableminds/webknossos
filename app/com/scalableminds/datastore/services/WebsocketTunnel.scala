/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import akka.actor.{ ActorRef, Actor }
import play.api.libs.ws.WS
import org.java_websocket.client._
import org.java_websocket.handshake.ServerHandshake
import com.scalableminds.braingames.binary.Logger._
import java.net.URI
import play.api.libs.json.{ Json, JsValue }
import com.fasterxml.jackson.core.JsonParseException
import scala.concurrent.{ Await, Future }
import scala.concurrent.duration._
import java.nio.ByteBuffer
import play.api.mvc.Codec
import net.liftweb.common.Failure
import java.io.{ File, FileInputStream }
import java.security.KeyStore
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import java.util.concurrent.TimeoutException
import akka.agent.Agent
import scala.collection.immutable.Queue

case class SendJson(js: JsValue, retryOnFailure: Boolean = true)(implicit codec: Codec) extends WSMessage[Array[Byte]] {
  def payload = codec.encode(Json.prettyPrint(js))
}

case class SendData(data: Array[Byte], retryOnFailure: Boolean = true) extends WSMessage[Array[Byte]] {
  def payload = data
}

case class SendString(s: String, retryOnFailure: Boolean = true)(implicit codec: Codec) extends WSMessage[Array[Byte]] {
  def payload = codec.encode(s)
}

sealed trait WSMessage[T] {
  def payload: T

  def retryOnFailure: Boolean
}

case class ReceivedString(s: String)

case object ConnectToWS

case class KeyStoreInfo(keyStore: File, keyStorePassword: String)
case class WSSecurityInfo(secured: Boolean, selfSigned: Boolean, keyStoreInfo: Option[KeyStoreInfo])

trait JsonMessageHandler {
  def handle(js: JsValue): Future[Either[JsValue, Array[Byte]]]
}

class JsonWSTunnel(
  serverUrl: String,
  incomingMessageHandler: JsonMessageHandler,
  webSocketSecurityInfo: WSSecurityInfo)(implicit codec: Codec) extends Actor {

  implicit val exco = context.system.dispatcher

  private var isTerminating = false

  private var isReconnectPaused = true

  private val reconnectThrottle = 1 second

  private val websocket = Agent[Option[WebSock]](None)

  private val messageQueue = Agent[Queue[WSMessage[_]]](Queue.empty)

  private val ConnectTimeout = 2 minutes

  private val PingInterval = 5 seconds

  private class WebSock(receiver: ActorRef, url: String) extends WebSocketClient(new URI(url)) {
    def onOpen(handshakedata: ServerHandshake): Unit = {
    }

    def onError(ex: Exception): Unit = {
      logger.error("Websocket error.", ex)
    }

    def onClose(code: Int, reason: String, remote: Boolean): Unit = {
      logger.warn(s"Websocket closed. Reason: $reason Code: $code")
      self ! ConnectToWS
    }

    def onMessage(message: String): Unit = {
      receiver ! ReceivedString(message)
      logger.trace(s"Websocket string message: $message")
    }

    override def onMessage(blob: ByteBuffer): Unit = {
      logger.trace(s"Websocket blob message. Size: ${blob.limit()}")
      onMessage(codec.decode(blob.array()))
    }
  }

  override def preStart = {
    self ! ConnectToWS

    context.system.scheduler.schedule(reconnectThrottle, reconnectThrottle){
      isReconnectPaused = false
    }
    context.system.scheduler.schedule(PingInterval, PingInterval, self, SendJson(ping, retryOnFailure = false))
    super.preStart
  }

  override def postStop = {
    isTerminating = true
    closeCurrentWS()
    super.postStop
  }

  def receive = {
    case ConnectToWS =>
      connect(serverUrl)

    case msg: WSMessage[_] =>
      messageQueue.send{ msgs =>
        msgs.map( m => tryToSend(m))
        tryToSend(msg)
        Queue.empty
      }

    case ReceivedString(s) =>
      try {
        val js = Json.parse(s)
        incomingMessageHandler.handle(js).map {
          case Right(enumerator) =>
            self ! SendData(enumerator)
          case Left(json) =>
            self ! SendJson(json)
        }
      } catch {
        case e: JsonParseException =>
          logger.error(s"Received invalid json from WS: $s")
      }
  }

  val ping = Json.obj(
    "ping" -> ":D"
  )

  def isAlive = {
    websocket().map(w => w.getConnection.isOpen || w.getConnection.isConnecting) getOrElse false
  }

  private def initializeWS(): WebSock = {
    val w = new WebSock(self, serverUrl)

    if(webSocketSecurityInfo.secured){
      val sslContext = SSLContext.getInstance("TLS");
      webSocketSecurityInfo.keyStoreInfo.map{keyStoreInfo =>
        //load keystore for self signed certificate
        val storetype = "JKS";

        val ks = KeyStore.getInstance(storetype);
        ks.load(new FileInputStream(keyStoreInfo.keyStore), keyStoreInfo.keyStorePassword.toCharArray());

        val tmf = TrustManagerFactory.getInstance("SunX509");
        tmf.init(ks);
        tmf
      } match {
        case Some(tmf) =>
          sslContext.init(null, tmf.getTrustManagers, null);
        case _ =>
          sslContext.init(null, null, null);
      }
      w.setWebSocketFactory(new DefaultSSLWebSocketClientFactory(sslContext));
    }
    w
  }

  def scheduleReconnect() = {
    context.system.scheduler.scheduleOnce(1 second, self, ConnectToWS)
  }

  def connect(url: String) = {
    // Connecting to the websocket is a little difficult. If the websocket doesn't exist / respond the call to
    // `connectBlocking` doesn't fail or return
    if(!isTerminating && !isReconnectPaused) {
      isReconnectPaused = true
      try {
        val f = Future {
          if (!isAlive) {
            closeCurrentWS()
            val w = initializeWS()
            logger.debug(s"About to connect to WS.")
            if (w.connectBlocking()) {
              logger.debug(s"Connected to WS.")
              updateWebsocket(w)
            } else {
              logger.warn(s"Connection failed.")
              scheduleReconnect()
            }
          }
        }
        Await.result(f, atMost = ConnectTimeout)
      } catch {
        case e: TimeoutException =>
          logger.warn(s"WS connection took too long. Aborting.")
          scheduleReconnect()
        case e: Exception =>
          logger.error(s"Trying to connect to WS resulted in: ${e.getMessage}", e)
          scheduleReconnect()
      }
    }
  }

  def updateWebsocket(ws: WebSock) = {
    websocket.send {
      w =>
        w.map(_.close)
        Some(ws)
    }
  }

  def closeCurrentWS() = {
    websocket.send {
      ws =>
        ws.map(_.close())
        None
    }
  }

  def tryToSend(t: WSMessage[_]) = {
    def retry() = {
      if(t.retryOnFailure) {
        logger.info("Scheduling retry for message.")
        messageQueue.send(_.enqueue(t))
      }
      scheduleReconnect()
    }

    websocket() match {
      case Some(ws) =>
        try {
          t.payload match {
            case s: String =>
              ws.send(s)
            case bs: Array[Byte] =>
              ws.send(bs)
            case _ =>
              Failure("Can't send. Unsupported content")
          }
        } catch {
          case e: Exception =>
            logger.warn("Message send failed.", e)
            retry()
        }
      case _ =>
        logger.warn("Message send failed. Scheduling retry. No websocket present")
        retry()
    }
  }
}
