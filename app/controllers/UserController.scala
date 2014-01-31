package controllers

import oxalis.security.Secured
import models.user._
import models.task._
import models.annotation._
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.i18n.Messages
import oxalis.user.UserCache
import play.api.libs.concurrent.Execution.Implicits._
import views._
import braingames.util.ExtendedTypes.ExtendedList
import braingames.util.ExtendedTypes.ExtendedBoolean
import play.api.Logger
import models.binary.DataSet
import scala.concurrent.Future
import braingames.util.{Fox, FoxImplicits}

object UserController extends Controller with Secured with Dashboard {

  def dashboard = Authenticated.async {
    implicit request => {
      dashboardInfo(request.user).map { info =>
        Ok(html.user.dashboard.userDashboard(info))
      }
    }
  }

  def getDashboardInfo = Authenticated.async {
    implicit request => {
      val futures = dashboardInfo(request.user).map { info =>

        val loggedTime = info.loggedTime.map { case (paymentInterval, duration) =>
          // TODO make formatTimeHumanReadable(duration) (?) work
          Json.obj("paymentInterval" -> paymentInterval, "duration" -> duration.toString)
        }

        for {
          taskList <- Future.traverse(info.tasks)({
            case (task, annotation) =>
              for {
                tasks <- Task.transformToJson(task)
                annotations <- Annotation.transformToJson(annotation)
              } yield (tasks, annotations)
          })
          exploratoryList <- Future.traverse(info.exploratory)(Annotation.transformToJson(_))
        } yield {
          Json.obj(
            "user" -> info.user,
            "loggedTime" -> loggedTime,
            "dataSets" -> info.dataSets,
            "hasAnOpenTask" -> info.hasAnOpenTask,
            "exploratory" -> Json.toJson(exploratoryList),
            "tasks" -> Json.toJson(taskList.map(tuple => Json.obj("tasks" -> tuple._1, "annotation" -> tuple._2)))
          )
        }
      }

      futures.flatMap { f =>
        f.map { content => JsonOk(Json.obj("data" -> content)) }
      }

    }
  }

  def saveSettings = Authenticated.async(parse.json(maxLength = 2048)) { implicit request =>
    (for {
      settings <- request.body.asOpt[JsObject] ?~> Messages("user.settings.invalid")
      if (UserSettings.isValid(settings))
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

  def defaultSettings = Authenticated{ implicit request =>
    Ok(toJson(UserSettings.defaultSettings.settings))
  }
}