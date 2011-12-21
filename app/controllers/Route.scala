package controllers

import play.api.json._
import models.{FlightRoute, OriginPosDir}
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.geometry.Point3D
import brainflight.tools.geometry.Point3D._

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
      case null => throw new NoSuchElementException("no OriginLocations saved.")
      case route => route
    }
    val initdata = FlightRoute.createForUser(userId, start.porection.position :: Nil)

    val data = Map(
      "id" -> toJson(initdata._id.toString),
      "position" -> toJson(start.porection.position),
      "direction" -> toJson(start.porection.direction)
    )
    OriginPosDir.incUsed(start)
    Ok(toJson(data)).as("application/json")
  }

  def blackBox(id: String) = Action {
    implicit request =>
    def f(implicit request: Request[AnyContent]): Result = {
      val parsedJson = request.body.asJson.get
      val fr = FlightRoute.findOpenByID(id) match {
        case Some(fr) if fr.user_id ==userId => fr
        case _ => return BadRequest("No open route found.")
      }

      return parsedJson.asOpt[List[Point3D]] match {
        case Some(list) =>
          FlightRoute.save(fr.copy(points = fr.points ::: list ))
          Ok
        case None => BadRequest("Json invalid.")
      }
    }
    f(request)
  }

}