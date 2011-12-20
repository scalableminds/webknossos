package controllers

import play.api.json._
import models.{FlightRoute, OriginLocDir}
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.geometry.Vector3D._
import brainflight.tools.geometry.Vector3D

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */
object Route extends Controller with Secured {

  def initialize = Action {
    implicit request =>
    val start = OriginLocDir.leastUsed match {
      case null => throw new NoSuchElementException("no OriginLocations saved.")
      case route => route
    }
    val initdata = FlightRoute.createForUser(userId, start.lorection.location :: Nil)

    val data = collection.Map(
      "id" -> initdata._id.toString,
      "location" -> start.lorection.location.toString,
      "direction" -> start.lorection.direction.toString
    )
    Ok(toJson(data)).as("application/json")
  }

  def blackBox = Action {
    implicit request =>
    def f(implicit request: Request[AnyContent]): Result = {
      val parsedJson = parseJson(request.body.toString)
      val id = (parsedJson \ "id").asOpt[String] match {
        case Some(id) => id
        case _ => return BadRequest
      }
      val fr = FlightRoute.findOneByID(id) match {
        case Some(fr) if fr.user_id ==userId => fr
        case _ => return BadRequest
      }

      return (parsedJson \ "positions").asOpt[List[Vector3D]] match {
        case Some(list) =>
          FlightRoute.save(fr.copy(points = fr.points ::: list ))
          Ok
        case None => BadRequest
      }
    }
    f(request)
  }

}