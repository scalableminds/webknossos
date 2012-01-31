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
import brainflight.tools.geometry.Vector3D._
import brainflight.tools.geometry.Figure
import play.api.libs.concurrent._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 13:21
 */

object BinaryData extends Controller with Secured {

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
  def dataWebsocket( modelType: String ) = WebSocket.using[Array[Byte]] { request =>
    val output = new PushEnumerator[Array[Byte]]
    val input = Iteratee.foreach[Array[Byte]]( in => {
      println( "Message arrived! Bytes: %d".format( in.length ) )
      val start = System.currentTimeMillis()
      // first 4 bytes are always used as a client handle
      if ( in.length >= 68 && in.length % 4 == 0 ) {
        val ( binHandle, inRest ) = in.splitAt( 4 )
        val ( binMatrix, binClientCoord ) = inRest.splitAt( 64 )

        // convert the matrix from byte to float representation
        val matrix = binMatrix.subDivide( 4 ).map( _.reverse.toFloat )
        val pauseStart = System.currentTimeMillis()
        val clientCoord = binClientCoord.subDivide( 4 ).map( _.reverse.toFloat ).map( _.toInt )
        val pauseEnd = System.currentTimeMillis()

        ModelStore( modelType ) match {
          case Some( model ) =>
            val figure = Figure( model.polygons.map( _.rotateAndMove( matrix ) ) )
            val coordinates = pointsInFigure( figure )

            Akka.future {
              def f( x: Array[Int], y: Seq[Tuple3[Int, Int, Int]] ) {
                if ( x.length / 3 != y.length ) System.err.println( "Size doesn't match! %d (S) != %d (C)".format( y.length, x.length / 3 ) )
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
                println( "Compare completed! Handle: " + binHandle.toFloat )
              }
              f( clientCoord, coordinates )
            }
            // rotate the model and generate the requested data
            val result: Array[Byte] =
              coordinates.map( DataStore.load ).toArray
            val end = System.currentTimeMillis()
            println( "Calculated %d points in %d ms. Handle: %s".format( coordinates.size, end + pauseEnd - pauseStart - start, binHandle.toFloat ) )
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
      case Some( m ) =>
        Ok( toJson( m.vertices ) )
      case _ =>
        NotFound( "Model not available." )
    }
  }
  def polygons( modelType: String ) = Action {
    ModelStore( modelType ) match {
      case Some( m ) =>
        Ok( toJson( m.polygons ) )
      case _ =>
        NotFound( "Model not available." )
    }
  }
}