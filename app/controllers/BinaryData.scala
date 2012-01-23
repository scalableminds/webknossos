package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json._

import models._
import views._

import brainflight.binary._
import java.nio.ByteBuffer
import akka.actor._
import akka.util.duration._

import play.api.libs.akka._

import play.api.Play.current

import play.api.libs.iteratee._
import Input.EOF
import play.api.libs.concurrent._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 13:21
 */

object BinaryData extends Controller with Secured {

  def data( modelType: String, px: String, py: String, pz: String, ax: String, ay: String, az: String ) = Action {
    val axis = ( ax.toDouble, ay.toDouble, az.toDouble )
    val point = ( px.toDouble, py.toDouble, pz.toDouble )
    ( ModelStore( modelType ), axis ) match {
      case ( _, ( 0, 0, 0 ) ) =>
        BadRequest( "Axis is not allowed to be (0,0,0)." )
      case ( Some( m ), _ ) =>
        Ok( ( m.rotateAndMove( point, axis ).map( DataStore.load ).toArray ) )
      case _ =>
        NotFound( "Model not available." )
    }
  }

  def dataWebsocket( modelType: String ) = WebSocket.using[Array[Byte]] { request =>
    val output = new PushEnumerator[Array[Byte]]
    val input = Iteratee.foreach[Array[Byte]]( in => {
      println( "Message arrived! Bytes: %d".format( in.length ) )
      val ( binHandle, binMatrix ) = in.splitAt( 4 )
      if ( binMatrix.length % 4 == 0 ) {
        val matrix = subDivide( binMatrix, 4 ) map toFloat

        ModelStore( modelType ) match {
          case Some( m ) =>
            val result: Array[Byte] =
              m.rotateAndMove( matrix ).map( DataStore.load ).toArray
            output.push( binHandle ++ result )
          case _ =>
            output.push( binHandle )
        }

      } else {
        output.push( binHandle )
      }
    } )

    ( input, output )
  }
  def subDivide[T]( list: Array[T], subCollectionSize: Int ): List[Array[T]] = {
    val numFloatBytes = 4
    if ( list.length <= subCollectionSize ) {
      list :: Nil
    } else {
      var result = List[Array[T]]()
      for ( i <- 0 until list.length by numFloatBytes ) {
        result ::= list.slice( i, i + numFloatBytes )
      }
      result
    }
  }

  def toFloat( bytes: Array[Byte] ) = {
    ByteBuffer.wrap( bytes.reverse ).getFloat

  }
  def toBinary( float: Float ) = {
    val result = new Array[Byte]( 4 )
    ByteBuffer.wrap( result ).putFloat( float )
    result
  }

  def model( modelType: String ) = Action {
    ModelStore( modelType ) match {
      case Some( m ) =>
        Ok( m.modelInformation )
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