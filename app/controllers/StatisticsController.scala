/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import scala.concurrent.Future

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationService}
import models.task.{TaskService, TaskType}
import models.task.OpenAssignmentService
import oxalis.security.Secured
import models.user.time.{TimeSpan, TimeSpanService}
import models.user.{User, UserDAO, UserService}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.libs.json.Json._
import play.api.libs.functional.syntax._
import play.twirl.api.Html
import models.user.{User, UserDAO, UserService}
import scala.concurrent.duration.Duration

import models.tracing.skeleton.DBTreeDAO
import models.binary.DataSetDAO
import models.project.Project

class StatisticsController @Inject()(val messagesApi: MessagesApi)
  extends Controller
  with Secured {

  val intervalHandler = Map(
    "month" -> TimeSpan.groupByMonth _,
    "week" -> TimeSpan.groupByWeek _
  )

  def intervalTracingTimeJson[T <: models.user.time.Interval](times: Map[T, Duration]) = times.map {
    case (interval, duration) => Json.obj(
      "start" -> interval.start.toString,
      "end" -> interval.end.toString,
      "tracingTime" -> duration.toMillis
    )
  }

  def empty = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def oxalis(interval: String, start: Option[Long], end: Option[Long]) = Authenticated.async { implicit request =>
    intervalHandler.get(interval) match {
      case Some(handler) =>
        for {
          times <- TimeSpanService.loggedTimePerInterval(handler, start, end)
          numberOfUsers <- UserService.countNonAnonymousUsers
          numberOfDatasets <- DataSetDAO.count(Json.obj())
          numberOfAnnotations <- AnnotationDAO.countAll
          numberOfTrees <- DBTreeDAO.count(Json.obj())
          numberOfAssignments <- OpenAssignmentService.countOpenAssignments
        } yield {
          Ok(Json.obj(
            "name" -> "oxalis",
            "tracingTimes" -> intervalTracingTimeJson(times),
            "numberOfUsers" -> numberOfUsers,
            "numberOfDatasets" -> numberOfDatasets,
            "numberOfAnnotations" -> numberOfAnnotations,
            "numberOfTrees" -> numberOfTrees,
            "numberOfOpenAssignments" -> numberOfAssignments
          ))
        }
      case _             =>
        Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
    }
  }

  def users(interval: String, start: Option[Long], end: Option[Long], limit: Int) = Authenticated.async { implicit request =>
    for {
      handler <- intervalHandler.get(interval) ?~> Messages("statistics.interval.invalid")
      users <- UserDAO.findAll
      usersWithTimes <- Fox.serialCombined(users)(user => TimeSpanService.loggedTimeOfUser(user, handler, start, end).map(user -> _))
    } yield {
      val data = usersWithTimes.sortBy(-_._2.map(_._2.toMillis).sum).take(limit)
      val json = data.map {
        case (user, times) => Json.obj(
          "user" -> User.userCompactWrites.writes(user),
          "tracingTimes" -> intervalTracingTimeJson(times)
        )
      }
      Ok(Json.toJson(json))
    }
  }
}
