package controllers

import models.user.User
import models.annotation.{AnnotationService, Annotation}
import models.task.Task
import models.binary.DataSet
import models.user.time._
import models.binary.DataSetDAO
import braingames.util.ExtendedTypes.ExtendedList
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext
import play.api.Logger
import braingames.util.Fox
import play.api.libs.json._
import net.liftweb.common.{Empty, Failure, Full}
import scala.concurrent.Future
import net.liftweb.common.Full
import scala.concurrent.duration.Duration

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 07.11.13
 * Time: 20:58
 */
case class DashboardInfo(
                          user: User,
                          exploratory: List[Annotation],
                          tasks: List[(Task, Annotation)],
                          loggedTime: Map[Month, Duration],
                          dataSets: List[DataSet],
                          hasAnOpenTask: Boolean
                        )


trait Dashboard {
  private def userWithTasks(user: User)(implicit ctx: DBAccessContext): Fox[List[(Task, Annotation)]] = {
    AnnotationService.findTasksOf(user).flatMap{ taskAnnotations => Fox(
      Fox.sequence(taskAnnotations.map(a => a.task.map(_ -> a))).map(els => Full(els.flatten)))
    }
  }

  private def exploratorySortedByTime(exploratoryAnnotations: List[Annotation]) =
    exploratoryAnnotations.futureSort(_.content.map(-_.timestamp).getOrElse(0L))

  private def hasOpenTask(tasksAndAnnotations: List[(Task, Annotation)]) =
    tasksAndAnnotations.exists { case (_, annotation) => !annotation.state.isFinished }

  def dashboardInfo(user: User, requestingUser: User)(implicit ctx: DBAccessContext) = {
    for {
      exploratoryAnnotations <- AnnotationService.findExploratoryOf(user)
      dataSets <- DataSetDAO.findAllActive
      loggedTimeAsMap <- TimeSpanService.loggedTimeOfUser(user, TimeSpan.groupByMonth _)
      exploratoryAnnotations <- exploratorySortedByTime(exploratoryAnnotations).toFox
      userTasks <- userWithTasks(user)
    } yield {

      val loggedTime = loggedTimeAsMap.map { case (paymentInterval, duration) =>
        Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
      }

      for {
        tasksWithAnnotations <- Future.traverse(userTasks)({
          case (task, annotation) =>
            for {
              taskJSON <- Task.transformToJson(task)
              annotationJSON <- Annotation.transformToJson(annotation)
            } yield (taskJSON, annotationJSON)
        })
        exploratoryList <- Future.traverse(exploratoryAnnotations)(Annotation.transformToJson(_))
      } yield {
        Json.obj(
          "user" -> Json.toJson(user)(User.userPublicWrites(requestingUser)),
          "loggedTime" -> loggedTime,
          "dataSets" -> dataSets,
          "hasAnOpenTask" -> hasOpenTask(userTasks),
          "exploratory" -> Json.toJson(exploratoryList),
          "tasksWithAnnotations" -> Json.toJson(
            tasksWithAnnotations.map(tuple => Json.obj("task" -> tuple._1, "annotation" -> tuple._2))
          )
        )
      }
    }

 }
}
