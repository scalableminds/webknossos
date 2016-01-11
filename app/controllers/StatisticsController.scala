/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import oxalis.security.Secured
import models.user.time.{TimeSpan, TimeSpanService}
import play.api.i18n.{MessagesApi, Messages}
import play.api.libs.json.Json
import com.scalableminds.util.tools.Fox
import play.api.libs.concurrent.Execution.Implicits._
import models.user.{User, UserDAO}
import play.twirl.api.Html
import scala.concurrent.duration.Duration
import models.annotation.AnnotationDAO

class StatisticsController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured{
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
    Ok(views.html.main()(Html("")))
  }

  def oxalis(interval: String, start: Option[Long], end: Option[Long]) = Authenticated.async{ implicit request =>
    intervalHandler.get(interval) match{
      case Some(handler) =>
        for{
          times <- TimeSpanService.loggedTimePerInterval(handler, start, end)
          numberOfAnnotations <- AnnotationDAO.countAll
          numberOfUsers <- UserDAO.count(Json.obj())
        } yield {
          Ok(Json.obj(
            "name" -> "oxalis",
            "tracingTimes" -> intervalTracingTimeJson(times),
            "numberOfAnnotations" -> numberOfAnnotations,
            "numberOfUsers" -> numberOfUsers
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
