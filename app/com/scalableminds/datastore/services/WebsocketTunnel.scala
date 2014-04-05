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

trait JsonMessageHandler {
  def handle(js: JsValue): Future[Either[JsValue, Array[Byte]]]
}

class JsonWSTunnel(
  serverUrl: String,
  incomingMessageHandler: JsonMessageHandler,
  keystoreOpt: Option[File] = None,
  keystorePasswordOpt: Option[String] = None)(implicit codec: Codec) extends Actor {

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
      logger.warn(s"Websocket string message: $message")
    }

    override def onMessage(blob: ByteBuffer): Unit = {
      logger.warn(s"Websocket blob message. Size: ${blob.limit()}")
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
            logger.info("Scheduling binary data return value")
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
      keystore <- keystoreOpt
      keystorePassword <- keystorePasswordOpt
    } {
      val storetype = "JKS";

      val ks = KeyStore.getInstance(storetype);
      ks.load(new FileInputStream(keystore), keystorePassword.toCharArray());

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


//public class SSLClientExample {
//
//  /*
//   * Keystore with certificate created like so (in JKS format):
//   *
//   *keytool -genkey -validity 3650 -keystore "keystore.jks" -storepass "storepassword" -keypass "keypassword" -alias "default" -dname "CN=127.0.0.1, OU=MyOrgUnit, O=MyOrg, L=MyCity, S=MyRegion, C=MyCountry"
//   */
//  public static void main( String[] args ) throws Exception {
//    WebSocketImpl.DEBUG = true;
//
//    WebSocketChatClient chatclient = new WebSocketChatClient( new URI( "wss://localhost:8887" ) );
//
//    // load up the key store
//    String STORETYPE = "JKS";
//    String KEYSTORE = "keystore.jks";
//    String STOREPASSWORD = "storepassword";
//    String KEYPASSWORD = "keypassword";
//
//    KeyStore ks = KeyStore.getInstance( STORETYPE );
//    File kf = new File( KEYSTORE );
//    ks.load( new FileInputStream( kf ), STOREPASSWORD.toCharArray() );
//
//    KeyManagerFactory kmf = KeyManagerFactory.getInstance( "SunX509" );
//    kmf.init( ks, KEYPASSWORD.toCharArray() );
//    TrustManagerFactory tmf = TrustManagerFactory.getInstance( "SunX509" );
//    tmf.init( ks );
//
//    SSLContext sslContext = null;
//    sslContext = SSLContext.getInstance( "TLS" );
//    sslContext.init( kmf.getKeyManagers(), tmf.getTrustManagers(), null );
//    // sslContext.init( null, null, null ); // will use java's default key and trust store which is sufficient unless you deal with self-signed certificates
//
//    SSLSocketFactory factory = sslContext.getSocketFactory();// (SSLSocketFactory) SSLSocketFactory.getDefault();
//
//    chatclient.setSocket( factory.createSocket() );
//
//    chatclient.connectBlocking();
//
//    BufferedReader reader = new BufferedReader( new InputStreamReader( System.in ) );
//    while ( true ) {
//      String line = reader.readLine();
//      if( line.equals( "close" ) ) {
//        chatclient.close();
//      } else {
//        chatclient.send( line );
//      }
//    }