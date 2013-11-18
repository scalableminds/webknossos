package controllers

import models.user.User
import models.annotation.{AnnotationService, Annotation}
import models.task.Task
import models.user.time.TimeTracking._
import braingames.binary.models.DataSet
import models.user.time.TimeTrackingService
import models.binary.DataSetDAO
import braingames.util.ExtendedTypes.ExtendedList
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext
import play.api.Logger

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
                          loggedTime: LoggedPerPaymentInterval,
                          dataSets: List[DataSet],
                          hasAnOpenTask: Boolean
                        )

trait Dashboard {
  def dashboardInfo(user: User)(implicit ctx: DBAccessContext) = {
    val taskAnnotations = AnnotationService.findTasksOf(user)
    val exploratoryAnnotations = AnnotationService.findExploratoryOf(user)

    Logger.error("exploratory annotations: " + exploratoryAnnotations.size)

    val annotationsF = exploratoryAnnotations.futureSort(_.content.map(-_.timestamp).getOrElse(0L))

    for {
      exploratoryAnnotations <- annotationsF
      userTasks = taskAnnotations.flatMap(a => a.task.map(_ -> a))
      hasAnOpenTask = userTasks.find(!_._2.state.isFinished).isDefined
      loggedTime <- TimeTrackingService.loggedTime(user)
      dataSets <- DataSetDAO.findAll
    } yield {
      DashboardInfo(
        user,
        exploratoryAnnotations,
        userTasks,
        loggedTime,
        dataSets,
        hasAnOpenTask)
    }
  }
}