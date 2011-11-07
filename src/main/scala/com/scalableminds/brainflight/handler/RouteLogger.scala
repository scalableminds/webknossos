package com.scalableminds.brainflight.handler

import net.liftweb.json._
import net.liftweb.json.JsonDSL._
import net.liftweb.util.Helpers._
import net.liftweb.common.{Failure, Full}
import net.liftweb.http.{NoContentResponse, BadResponse, JsonResponse, LiftResponse}
import com.scalableminds.brainflight.model.{SessionRoute, FlightRoute, User, RoutePoint}

/**
 * Scalable Minds - Brainflight
 * User: tmbo
 * Date: 06.11.11
 * Time: 14:14
 */

object RouteLogger {
  def apply(parsedJson: JValue): LiftResponse = {
    implicit val formats = DefaultFormats
    // extract positions
    val list = (parsedJson \ "positions").extract[List[List[Int]]]
    // conert positions to RoutePoints
    val points: List[RoutePoint] = for (el <- list) yield RoutePoint(el(0), el(1), el(2))
    // if start is sent and set to true the old route is getting saved and a new one is created. Otherwise the new
    // points are appended
    parsedJson \ "start" match {
      case JBool(true) =>
        SessionRoute.saveRoute(User.currentUser)
        SessionRoute(FlightRoute.createRecord.points(points))
      case _ =>
        val route = SessionRoute.get
        route.points(route.points.is ::: points)
    }
    NoContentResponse()
  }
}