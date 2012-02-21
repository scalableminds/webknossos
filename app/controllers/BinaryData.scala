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
import brainflight.tools.ExtendedDataTypes._
import brainflight.tools.Math._
import brainflight.tools.geometry.Vector3I._
import brainflight.tools.geometry.Figure
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
  val WebSocketMatrixLength = RotationMatrixSize3D * 4
  val MinWebSocketRequestSize = WebSocketHandleLength + WebSocketMatrixLength

  def calculateBinaryData( model: DataModel, matrix: Array[Float], clientCoordinates: Array[Int] = Array() ) = {
    if ( matrix.length != RotationMatrixSize3D ) {
      println( "Size: " + matrix.length )
      Array[Byte]()
    } else {
      val figure = Figure( model.polygons.map( _.transformAffine( matrix ) ) )
      val coordinates = figure.calculateInnerPoints()

      Akka.future {
        def f( x: Array[Int], y: Seq[Tuple3[Int, Int, Int]] ) {
          if ( x.length / 3 != y.length )
            System.err.println( "Size doesn't match! %d (S) != %d (C)".format( y.length, x.length / 3 ) )
          val it = x.iterator
          var failed = 0
          y.zipWithIndex.foreach {
            case ( e, i ) => {
              if ( it.hasNext ) {
                val client = ( it.next, it.next, it.next )
                if ( e != client && failed < 20 ) {
                  failed += 1
                  System.err.println( "ELEMTNS don't match: %s (S) <-> %s (C)".format( e, client ) )
                }
              }
            }
          }
        }
        f( clientCoordinates, coordinates )
      }
      // rotate the model and generate the requested data
      coordinates.map( dataStore.load ).toArray
    }
  }

  def requestViaAjax( modelType: String ) = Action { implicit request =>
    ( request.body.asRaw, ModelStore( modelType ) ) match {
      case ( Some( binRequest ), Some( model ) ) =>
        val binMatrix = binRequest.asBytes().getOrElse( Array[Byte]() )
        val matrix = binMatrix.subDivide( 4 ).map( _.reverse.toFloat )
        val result = calculateBinaryData( model, matrix )
        Ok( result )
      case _ =>
        BadRequest( "Request needs to be binary" )
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
  def requestViaWebsocket( modelType: String ) =
    WebSocket.using[Array[Byte]] { request =>
      val output = Enumerator.imperative[Array[Byte]]()
      val input = Iteratee.foreach[Array[Byte]]( in => {
        //println( "Message arrived! Bytes: %d".format( in.length ) )
        // first 4 bytes are always used as a client handle
        if ( in.length >= MinWebSocketRequestSize && in.length % 4 == 0 ) {
          val ( binHandle, inRest ) = in.splitAt( WebSocketHandleLength )
          val ( binMatrix, binClientCoord ) = inRest.splitAt( WebSocketMatrixLength )

          // convert the matrix from byte to float representation
          val matrix = binMatrix.subDivide( 4 ).map( _.reverse.toFloat )
          val clientCoordinates =
            binClientCoord.subDivide( 4 ).map( _.reverse.toFloat ).map( _.toInt )

          ModelStore( modelType ) match {
            case Some( model ) =>
              val result = calculateBinaryData( model, matrix, clientCoordinates )
              output.push( binHandle ++ result )
            case _ =>
              output.push( binHandle )
          }
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