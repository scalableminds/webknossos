package controllers

import play.api.libs.json.Json._
import play.api.libs.json._
import models.{ TrackedRoute, RouteOrigin }
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.Math._
import brainflight.security.Secured
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */
object Route extends Controller with Secured {

  def initialize = Action { implicit request =>
    
    ( for {
      user <- maybeUser
      origin <- RouteOrigin.leastUsed
      startPoint <- origin.matrix.extractTranslation
    } yield {
      val route = TrackedRoute.createForUser(
        user,
        startPoint.toVector3I :: Nil )

      val data = Map(
        "id" -> toJson( route._id.toString ),
        "matrix" -> toJson( origin.matrix.value ) )

      RouteOrigin.increaseUsedCount( origin )
      Ok( toJson( data ) )
    } ) getOrElse NotFound( "Couldn't open new route." )
  }

  def blackBox( id: String ) = Action[JsValue]( parse.json( maxLength = 1024 * 1024 ) ) { implicit request =>
    val parsedJson = request.body

    ( for {
      user <- maybeUser
      route <- TrackedRoute.findOpenBy( id )
      points <- parsedJson.asOpt[List[Vector3I]]
      if ( route.userId == user._id )
    } yield {
      route.add( points )
      Ok
    } ) getOrElse BadRequest( "No open route found or JSON invalid." )

  }
  def getRoute( id: String ) = Action { implicit request =>
    
  	(for {
  	  user <- maybeUser
  	  route <- TrackedRoute.findOneByID( new ObjectId( id ) )
  	} yield {
  	  Ok( toJson( route.points ) )
  	}) getOrElse NotFound( "Couldn't open route." )
  	
  }
}