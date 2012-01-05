package controllers

import play.api.libs.json._
import models.{ FlightRoute, OriginPosDir }
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.geometry.Vector3D
import brainflight.tools.geometry.Vector3D._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */
object Route extends Controller with Secured {

  def initialize = Action {
    implicit request =>
      val start = OriginPosDir.leastUsed match {
        case null  => throw new NoSuchElementException( "no OriginLocations saved." )
        case route => route
      }
      val initdata = FlightRoute.createForUser( userId, start.porection.position :: Nil )

      val data = Map(
        "id" -> toJson( initdata._id.toString ),
        "position" -> toJson( start.porection.position ),
        "direction" -> toJson( start.porection.direction ) )
      OriginPosDir.incUsed( start )
      Ok( toJson( data ) ).as( "application/json" )
  }

  def blackBox( id: String ) = Action(parse.json(maxLength = 1024)) {
    implicit request =>
      def f( implicit request: Request[JsValue] ): Result = {
        val parsedJson = request.body
        val fr = FlightRoute.findOpenByID( id ) match {
          case Some( fr ) if fr.user_id == userId => fr
          case _                                  => return BadRequest( "No open route found." )
        }

        return parsedJson.asOpt[List[Vector3D]] match {
          case Some( list ) =>
            FlightRoute.save( fr.copy( points = fr.points ::: list ) )
            Ok
          case None => BadRequest( "Json invalid." )
        }
      }
      f( request )
  }
  def getRoute( id: String ) = Action {
    implicit request =>
      FlightRoute.findOneByID( new ObjectId( id ) ) match {
        case Some( fr ) if fr.user_id == userId =>
          Ok(toJson(fr.points))
        case _ =>
          BadRequest( "Buuuuuuuh." )
      }
  }
}