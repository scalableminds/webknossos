package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.libs.json._

import models._
import views._

import brainflight.binary._
import java.nio.ByteBuffer

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 13:21
 */

import play.api.libs.iteratee._
import Input.EOF
import play.api.libs.concurrent._

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

  def dataWebsocket() = WebSocket[Array[Byte]] { request =>
    ( in, out ) =>
      Logger.info( "Someone connected!" )

      in.mapInput {
        case Input.EOF => {
          Logger.info( "Someone disconnected. Cleaning resources" )
          EOF
        }
        case el => {
          Logger.info( "Got message: " + el.toString )
          el.map( bytes => {
            if ( bytes.length >= 4 ) {
              Logger.info( "Value: '%f' Num bytes: %d".format( toFloat( bytes ), bytes.length ) )
            } else {
              Logger.info( "Send me more!" )
            }
            0
          } )
          el
        }
      } |>> out

  }
  def toFloat( bytes: Array[Byte] ) = ByteBuffer.wrap( bytes ).getFloat

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