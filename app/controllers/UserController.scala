package controllers

import oxalis.security.Secured
import models.user._
import play.api.libs.json.Json._
import play.api.libs.json._
import models.security.{RoleDAO, Role}
import play.api.i18n.Messages
import oxalis.user.UserCache
import play.api.libs.concurrent.Execution.Implicits._
import views._
import braingames.util.ExtendedTypes.ExtendedList
import braingames.util.ExtendedTypes.ExtendedBoolean
import play.api.Logger
import braingames.binary.models.DataSet
import scala.concurrent.Future
import braingames.util.{Fox, FoxImplicits}

object UserController extends Controller with Secured with Dashboard {
  override val DefaultAccessRole = RoleDAO.User

  def dashboard = Authenticated().async {
    implicit request => {
      dashboardInfo(request.user).map { info =>
        Logger.error("##########     dashboardInfo      ################" +  info.toString)
        Ok(html.user.dashboard.userDashboard(info))
      }
    }
  }

  def getDashboardInfo = Authenticated().async {
    implicit request => {
      val futures = dashboardInfo(request.user).map { info =>

        // TODO: move dataSetFormat into braingames-libs and bump the necessary version
        implicit val dataSetFormat = Json.format[DataSet]

        val loggedTime = info.loggedTime.map { case(paymentInterval, duration) =>
          // TODO make formatTimeHumanReadable(duration) (?) work
          Json.obj("paymentInterval" -> paymentInterval, "duration" -> duration.toString)
        }

        val futureList = Future.traverse(info.tasks)( {
            case(task, annotation) => annotation.content.map(
              foxContent => Json.obj("task" -> task, "annotation" -> foxContent.toString)
            ).getOrElse(Json.obj("data" -> "data"))
          }
        )

        for {
          aList <- futureList
        } yield {
          Json.obj(
            "user" -> info.user,
            "exploratory" -> info.exploratory,
            "loggedTime" -> loggedTime,
            "dataSets" -> info.dataSets,
            "hasAnOpenTask" -> info.hasAnOpenTask,
            "tasks" -> Json.toJson(aList)
          )
        }
      }

      futures.flatMap { f =>
        f.map { content => JsonOk(Json.obj("data" -> content)) }
      }

    }
  }

// 
  // def TODOREMOVETHISoverview = Authenticated().async { implicit request =>
  //   def combineUsersWithCurrentTasks(users: List[User]) = {
  //     Fox.sequence(for {
  //       user <- users
  //       annotation <- AnnotationService.openTasksFor(user)
  //     } yield {
  //       for {
  //         task <- annotation.task.toFox
  //         taskType <- task.taskType
  //       } yield {
  //         user -> taskType
  //       }
  //     })
  //   }

  //   for {
  //     users <- UserService.findAll
  //     allTaskTypes <- TaskTypeDAO.findAll
  //     usersWithTasks <- combineUsersWithCurrentTasks(users)
  //     futureUserTaskAssignment <- TaskService.simulateTaskAssignment(users)
  //     futureTaskTypes <- Fox.sequence(futureUserTaskAssignment.map(e => e._2.taskType.map(e._1 -> _)).toList)
  //   } yield {
  //     Ok(html.admin.task.taskOverview(users, allTaskTypes, usersWithTasks.flatten.distinct, futureTaskTypes.flatten.toMap))
  //   }
  // }
// 
  def saveSettings = Authenticated().async(parse.json(maxLength = 2048)) { implicit request =>
    (for {
      settings <- request.body.asOpt[JsObject] ?~> Messages("user.settings.invalid")
      if(UserSettings.isValid(settings))
      _ <- UserService.updateSettings(request.user, UserSettings(settings.fields.toMap))
    } yield {
      UserCache.invalidateUser(request.user.id)
      JsonOk(Messages("user.settings.updated"))
    }) ~> Messages("user.settings.invalid")
  }

  def showSettings = UserAwareAction { implicit request =>
    val configuration = request.userOpt match {
      case Some(user) =>
        user.configuration.settingsOrDefaults
      case _ =>
        UserSettings.defaultSettings.settings
    }
    Ok(toJson(configuration))
  }

  def defaultSettings = Authenticated() { implicit request =>
    Ok(toJson(UserSettings.defaultSettings.settings))
  }
}