package controllers

import models.user.User
import models.annotation.{AnnotationService, Annotation, AnnotationLike}
import models.task.Task
import models.binary.DataSet
import models.user.time._
import models.binary.DataSetDAO
import braingames.util.ExtendedTypes.ExtendedList
import braingames.util.FoxImplicits
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


trait Dashboard extends FoxImplicits {
  private def userWithTasks(user: User)(implicit ctx: DBAccessContext): Fox[List[(Task, Annotation)]] = {
    AnnotationService.findTasksOf(user).flatMap{ taskAnnotations => Fox(
      Fox.sequence(taskAnnotations.map(a => a.task.map(_ -> a))).map(els => Full(els.flatten)))
    }
  }


  private def hasOpenTask(tasksAndAnnotations: List[(Task, Annotation)]) =
    tasksAndAnnotations.exists { case (_, annotation) => !annotation.state.isFinished }

  private def annotationsAsJson(annotations : Fox[List[AnnotationLike]], user : User)(implicit ctx: DBAccessContext) = {
    annotations.flatMap{ taskAnnotations =>
      Fox.sequence(taskAnnotations.map(AnnotationLike.annotationLikeInfoWrites(_, Some(user), List("content", "actions"))))
    }
  }


  def dashboardInfo(user: User, requestingUser: User)(implicit ctx: DBAccessContext) = {
    for {
      exploratoryAnnotations <- annotationsAsJson(AnnotationService.findExploratoryOf(user), user)
      tasksAnnotations <- annotationsAsJson(AnnotationService.findTasksOf(user), user)
    } yield {
      Json.obj(
        "user" -> Json.toJson(user)(User.userPublicWrites(requestingUser)),
        "exploratoryAnnotations" -> exploratoryAnnotations.flatMap ( o => o),
        "taskAnnotations" -> tasksAnnotations.flatMap ( o => o)
      )
    }

 }
}
