/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import models.user.User
import models.annotation.{AnnotationService, Annotation, AnnotationLike}
import models.task.Task
import models.binary.DataSet
import models.user.time._
import models.binary.DataSetDAO
import com.scalableminds.util.tools.ExtendedTypes.ExtendedList
import com.scalableminds.util.tools.FoxImplicits
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.Logger
import com.scalableminds.util.tools.Fox
import play.api.libs.json._
import net.liftweb.common.{Empty, Failure, Full}
import scala.concurrent.Future
import net.liftweb.common.Full
import scala.concurrent.duration.Duration

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
      Fox.sequence(taskAnnotations.map(AnnotationLike.annotationLikeInfoWrites(_, Some(user), exclude = List("content", "actions"))))
    }
  }


  def dashboardExploratoryAnnotations(user: User, requestingUser: User, isFinished: Boolean)(implicit ctx: DBAccessContext) = {
    for {
      exploratoryAnnotations <- annotationsAsJson(AnnotationService.findExploratoryOf(user, isFinished), user)
    } yield {
      JsArray(exploratoryAnnotations.flatten)
    }
 }

 def dashboardTaskAnnotations(user: User, requestingUser: User)(implicit ctx: DBAccessContext) = {
    for {
      tasksAnnotations <- annotationsAsJson(AnnotationService.findTasksOf(user), user)
    } yield {
      JsArray(tasksAnnotations.flatten)
    }
 }
}
