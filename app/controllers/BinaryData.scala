package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json.Json._
import models._
import views._
import brainflight.binary._
import java.nio.ByteBuffer
import akka.actor._
import akka.util.duration._
import play.api.Play.current
import play.api.libs.iteratee._
import Input.EOF
import play.api.libs.concurrent._
import brainflight.tools.ExtendedTypes._
import brainflight.tools.Math._
import brainflight.tools.geometry.Vector3I._

import brainflight.tools.geometry.{ Figure, Cube, Vector3I }
import play.api.libs.concurrent._
import play.api.libs.json.JsValue
import brainflight.security.Secured

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 13:21
 */

object BinaryData extends Controller with Secured {
  val dataStore: DataStore = FileDataStore

  val WebSocketHandleLength = 4
  val WebSocketCoordinatesLength = Vector3I.defaultSize * 4
  val MinWebSocketRequestSize = WebSocketHandleLength + WebSocketCoordinatesLength

  def calculateBinaryData( cubeSize: Int, cubeCorner: Array[Int], clientCoordinates: Array[Int] = Array() ) = {
    if ( cubeCorner.length != 3 ) {
      Logger.debug( "Wrong position Size: " + cubeCorner.length )
      Array[Byte]()
    } else {
      Logger.debug( "Corner: "+cubeCorner )
      val figure = Cube( cubeCorner, cubeSize )
      val coordinates = figure.calculateInnerPoints()

      /*Akka.future {
        def f( x: Array[Int], y: Seq[Tuple3[Int, Int, Int]] ) {
          if ( x.length / 3 != y.length )
            Logger.warn( "Size doesn't match! %d (S) != %d (C)".format( y.length, x.length / 3 ) )
          val it = x.iterator
          var failed = 0
          y.zipWithIndex.foreach {
            case ( e, i ) => {
              if ( it.hasNext ) {
                val client = ( it.next, it.next, it.next )
                if ( e != client && failed < 20 ) {
                  failed += 1
                  Logger.warn( "ELEMTNS don't match: %s (S) <-> %s (C)".format( e, client ) )
                }
              }
            }
          }
        }
        f( clientCoordinates, coordinates )
      }*/
      // rotate the model and generate the requested data
      coordinates.map( dataStore.load ).toArray
    }
  }

  def requestViaAjax( cubeSize: Int ) = Action(parse.raw) { implicit request =>
    ( request.body ) match {
      case body if body.size > WebSocketCoordinatesLength =>
        val binPosition = body.asBytes().getOrElse( Array[Byte]() )
        val position = binPosition.subDivide( 4 ).map( _.reverse.toIntFromFloat)
        val cubeCorner = position.map( x => x - x % cubeSize)
        val result = calculateBinaryData( cubeSize, position )
        Ok( result )
      case body =>
        BadRequest( "Request body is to short: %d bytes".format(body.size) )
    }
  }
  /**
   * Websocket implementation. Client needs to send a 4 byte handle and a 64
   * byte matrix. This matrix is used to apply a helmert transformation on the
   * model. After that the requested data is resolved and pushed back to the
   * output channel. The answer on the socket consists of the 4 byte handle and
   * the result data
   *
   * @param
   * 	modelType:	id of the model to use
   */
  def requestViaWebsocket( cubeSize: Int ) =
    WebSocket.using[Array[Byte]] { request =>
      val output = Enumerator.imperative[Array[Byte]]()
      val input = Iteratee.foreach[Array[Byte]]( in => {
        // first 4 bytes are always used as a client handle
        if ( in.length >= MinWebSocketRequestSize && in.length % 4 == 0 ) {
          val ( binHandle, inRest ) = in.splitAt( WebSocketHandleLength )
          val ( binPosition, binClientCoord ) = inRest.splitAt( WebSocketCoordinatesLength )

          // convert the matrix from byte to float representation
          val position = binPosition.subDivide( 4 ).map( _.reverse.toIntFromFloat)
          val cubeCorner = position.map( x => x - x % cubeSize)
          val clientCoordinates =
            binClientCoord.subDivide( 4 ).map( _.reverse.toFloat ).map( _.toInt )

            val result = calculateBinaryData( cubeSize, cubeCorner, clientCoordinates )
            output.push( binHandle ++ result )
        }
      } )

      ( input, output )
    }

  def model( modelType: String ) = Action {
    ModelStore( modelType ) match {
      case Some( model ) =>
        Ok( toJson( model.vertices.map( _.toVector3I ) ) )
      case _ =>
        NotFound( "Model not available." )
    }
  }
  def polygons( modelType: String ) = Action {
    ModelStore( modelType ) match {
      case Some( model ) =>
        Ok( toJson( model.polygons ) )
      case _ =>
        NotFound( "Model not available." )
    }
  }
}