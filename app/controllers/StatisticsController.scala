/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import oxalis.security.Secured
import models.user.time.{TimeSpan, TimeSpanService}
import play.api.i18n.Messages
import play.api.libs.json.Json
import braingames.util.Fox
import play.api.libs.concurrent.Execution.Implicits._
import models.user.{User, UserDAO}
import play.api.templates.Html
import scala.concurrent.duration.Duration
import models.annotation.AnnotationDAO
import braingames.reactivemongo.GlobalAccessContext
import models.tracing.skeleton.DBNodeDAO

object StatisticsController extends Controller with Secured{
  val intervalHandler = Map(
    "month" -> TimeSpan.groupByMonth _,
    "week" -> TimeSpan.groupByWeek _
  )

  def intervalTracingTimeJson[T<: models.user.time.Interval](times: Map[T, Duration]) = times.map{
    case (interval, duration) => Json.obj(
      "start" -> interval.start.toString(),
      "end" -> interval.end.toString(),
      "tracingTime" -> duration.toMillis
    )
  }

  def empty = Authenticated{ implicit request =>
    Ok(views.html.main()(Html.empty))
  }

  def oxalis(interval: String, start: Option[Long], end: Option[Long]) = Authenticated.async{ implicit request =>
    intervalHandler.get(interval) match{
      case Some(handler) =>
        for{
          times <- TimeSpanService.loggedTimePerInterval(handler, start, end)
          numberOfAnnotations <- AnnotationDAO.countAll(GlobalAccessContext)
          numberOfUsers <- UserDAO.count(Json.obj())(GlobalAccessContext)
          numberOfNodes <- DBNodeDAO.count(Json.obj())(GlobalAccessContext)
        } yield {
          Ok(Json.obj(
            "name" -> "oxalis",
            "tracingTimes" -> intervalTracingTimeJson(times),
            "numberOfAnnotations" -> numberOfAnnotations,
            "numberOfUsers" -> numberOfUsers,
            "numberOfNodes" -> numberOfNodes
          ))
        }
      case _ =>
        Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
    }
  }

  def users(interval: String, start: Option[Long], end: Option[Long], limit: Int) = Authenticated.async{ implicit request =>
    intervalHandler.get(interval) match{
      case Some(handler) =>
        for{
          users <- UserDAO.findAll
          usersWithTimes <- Fox.combined(users.map( user => TimeSpanService.loggedTimeOfUser(user, handler, start, end).map(user -> _)))
        } yield {
          val data = usersWithTimes.sortBy(-_._2.map(_._2.toMillis).sum).take(limit)
          val json = data.map{
            case (user, times) => Json.obj(
              "user" -> User.userCompactWrites(request.user).writes(user),
              "tracingTimes" -> intervalTracingTimeJson(times)
            )
          }
          Ok(Json.toJson(json))
        }
      case _ =>
        Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
    }
  }
}
