/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.services

import akka.actor.{ ActorRef, Actor }
import play.api.libs.ws.WS
import org.java_websocket.client._
import org.java_websocket.handshake.ServerHandshake
import braingames.binary.Logger._
import java.net.URI
import play.api.libs.json.{ Json, JsValue }
import com.fasterxml.jackson.core.JsonParseException
import scala.concurrent.{ Await, Future }
import scala.concurrent.duration._
import java.nio.ByteBuffer
import play.api.mvc.Codec
import net.liftweb.common.Failure
import java.io.{ File, FileInputStream }
import java.security.KeyStore;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

case class SendJson(js: JsValue)

case class SendData(data: Array[Byte])

case class ReceivedString(s: String)

case class ConnectToWS()

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

  private var websocket: Option[WebSock] = None

  private val ConnectTimeout = 10 seconds

  private val MaxSendRetries = 5

  private class WebSock(receiver: ActorRef, url: String) extends WebSocketClient(new URI(url)) {
    def onOpen(handshakedata: ServerHandshake): Unit = {
    }

    def onError(ex: Exception): Unit = {
      logger.error("Websocket error.", ex)
    }

    def onClose(code: Int, reason: String, remote: Boolean): Unit = {
      logger.warn(s"Websocket closed. Reason: $reason Code: $code")
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
    self ! ConnectToWS()
    super.preStart
  }

  override def postStop = {
    closeCurrentWS()
    super.postStop
  }

  def receive = {
    case ConnectToWS() =>
      connect(serverUrl)

    case SendJson(js) =>
      tryToSend(Json.prettyPrint(js))

    case SendData(data) =>
      tryToSend(data)

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

  def isAlive = {
    websocket.map(w => w.getConnection.isOpen || w.getConnection.isConnecting) getOrElse false
  }

  private def initializeWS(): WebSock = {
    val w = new WebSock(self, serverUrl)

    for {
      keyStoreInfo <- webSocketSecurityInfo.keyStoreInfo
    } {
      val storetype = "JKS";

      val ks = KeyStore.getInstance(storetype);
      ks.load(new FileInputStream(keyStoreInfo.keyStore), keyStoreInfo.keyStorePassword.toCharArray());

      val tmf = TrustManagerFactory.getInstance("SunX509");
      tmf.init(ks);

      val sslContext = SSLContext.getInstance("TLS");
      sslContext.init(null, tmf.getTrustManagers(), null);

      w.setWebSocketFactory(new DefaultSSLWebSocketClientFactory(sslContext));
    }
    w
  }

  def connect(url: String) = {
    // Connecting to the websocket is a little difficult. If the websocket doesn't exist / respond the call to
    // `connectBlocking` doesn't fail or return
    try {
      val f = Future {
        if (!isAlive) {
          closeCurrentWS()
          val w = initializeWS()
          logger.debug(s"About to connect to WS.")
          if (w.connectBlocking()) {
            logger.debug(s"Connected to WS.")
            websocket = Some(w)
          } else {
            throw new Exception("Connection failed.")
          }
        }
      }
      Await.result(f, atMost = ConnectTimeout)
    } catch {
      case e: Exception =>
        logger.error(s"Trying to connect to WS resulted in: ${e.getMessage}", e)
        self ! ConnectToWS
    }
  }

  def closeCurrentWS() = {
    websocket.map {
      ws =>
        ws.close()
    }
  }

  def tryToSend[T](t: T) = {
    def sendIt(numberOfRetries: Int) {
      websocket match {
        case Some(ws) =>
          try {
            t match {
              case s: String =>
                ws.send(s)
              case bs: Array[Byte] =>
                ws.send(bs)
              case _ =>
                Failure("Can't send. Unsupported content")
            }
          } catch {
            case e: Exception =>
              if (numberOfRetries < MaxSendRetries) {
                logger.warn(s"Sending json failed. Trying to reconnect... Exception: ${e.getMessage}")
                closeCurrentWS()
                connect(serverUrl)
                sendIt(numberOfRetries + 1)
              } else {
                logger.error("All attempts to send json failed. Stopping WS.")
              }
          }
        case _ =>
          logger.error("Can't send message, no websocket present")
      }
    }
    sendIt(numberOfRetries = 0)
  }
}
