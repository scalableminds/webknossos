/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationDAO, AnnotationService}
import models.binary.DataSetDAO
import models.project.Project
import models.task.{OpenAssignmentService, TaskService, TaskType}
import models.user.time.{TimeSpan, TimeSpanService}
import models.user.{User, UserDAO, UserService}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.twirl.api.Html

import scala.concurrent.Future
import scala.concurrent.duration.Duration

class StatisticsController @Inject()(val messagesApi: MessagesApi)
  extends Controller
  with UserAssignments
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

  def webKnossos(interval: String, start: Option[Long], end: Option[Long]) = Authenticated.async { implicit request =>
    intervalHandler.get(interval) match {
      case Some(handler) =>
        for {
          times <- TimeSpanService.loggedTimePerInterval(handler, start, end)
          numberOfUsers <- UserService.countNonAnonymousUsers
          numberOfDatasets <- DataSetDAO.count(Json.obj())
          numberOfAnnotations <- AnnotationDAO.countAll
          numberOfAssignments <- OpenAssignmentService.countOpenAssignments
        } yield {
          Ok(Json.obj(
            "name" -> "oxalis",
            "tracingTimes" -> intervalTracingTimeJson(times),
            "numberOfUsers" -> numberOfUsers,
            "numberOfDatasets" -> numberOfDatasets,
            "numberOfAnnotations" -> numberOfAnnotations,
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

trait UserAssignments extends Secured with Dashboard with FoxImplicits { this: Controller =>
  private case class UserWithTaskInfos(
    user: User,
    taskTypes: List[TaskType],
    projects: List[Project],
    futureTaskType: Option[TaskType],
    workingTime: Long)

  private object UserWithTaskInfos {
    def userInfosPublicWrites(requestingUser: User): Writes[UserWithTaskInfos] =
      ( (__ \ "user").write(User.userPublicWrites(requestingUser)) and
        (__ \ "taskTypes").write[List[TaskType]] and
        (__ \ "projects").write[List[Project]] and
        (__ \ "futureTaskType").write[Option[TaskType]] and
        (__ \ "workingTime").write[Long])( u =>
        (u.user, u.taskTypes, u.projects, u.futureTaskType, u.workingTime))
  }

  def assignmentStatistics(start: Option[Long], end: Option[Long]) = Authenticated.async { implicit request =>

    def getUserInfos(users: List[User]) = {

      val futureTaskTypeMap = for {
        futureTasks <- TaskService.simulateTaskAssignment(users)
        futureTaskTypes <- Fox.serialSequence(futureTasks.toList){
          case (user, task) => task.taskType.map(user -> _)
        }.map(_.flatten)
      } yield futureTaskTypes.toMap

      Future.traverse(users){user =>
        for {
          annotations <- AnnotationService.openTasksFor(user).getOrElse(Nil)
          tasks <- Fox.serialSequence(annotations)(_.task).map(_.flatten)
          projects <- Fox.serialSequence(tasks)(_.project).map(_.flatten)
          taskTypes <- Fox.serialSequence(tasks)(_.taskType).map(_.flatten)
          taskTypeMap <- futureTaskTypeMap.getOrElse(Map.empty)
          workingTime <- TimeSpanService.totalTimeOfUser(user, start, end).futureBox
        } yield {
          UserWithTaskInfos(
            user,
            taskTypes.distinct,
            projects.distinct,
            taskTypeMap.get(user),
            workingTime.map(_.toMillis).toOption.getOrElse(0)
          )
        }
      }
    }

    for {
      users <- UserService.findAllNonAnonymous()
      userInfos <- getUserInfos(users)
    } yield {
      Ok(Writes.list(UserWithTaskInfos.userInfosPublicWrites(request.user)).writes(userInfos))
    }
  }
}
