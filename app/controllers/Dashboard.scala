/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import scala.concurrent.duration.Duration

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationLike, AnnotationService}
import models.binary.DataSet
import models.task.Task
import models.user.User
import models.user.time._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._

case class DashboardInfo(
  user: User,
  exploratory: List[Annotation],
  tasks: List[(Task, Annotation)],
  loggedTime: Map[Month, Duration],
  dataSets: List[DataSet],
  hasAnOpenTask: Boolean
)


trait Dashboard extends FoxImplicits {

  private def annotationsAsJson(annotations: Fox[List[AnnotationLike]], user: User)(implicit ctx: DBAccessContext) = {
    annotations.flatMap { taskAnnotations =>
      Fox.serialSequence(taskAnnotations)(AnnotationLike.annotationLikeInfoWrites(_, Some(user), exclude = List("content")))
    }
  }


  def dashboardExploratoryAnnotations(user: User, requestingUser: User, isFinished: Option[Boolean], limit: Int)(implicit ctx: DBAccessContext) = {
    for {
      exploratoryAnnotations <- annotationsAsJson(AnnotationService.findExploratoryOf(user, isFinished, limit), user)
    } yield {
      JsArray(exploratoryAnnotations.flatten)
    }
  }

  def dashboardTaskAnnotations(user: User, requestingUser: User, isFinished: Option[Boolean], limit: Int)(implicit ctx: DBAccessContext) = {
    for {
      tasksAnnotations <- annotationsAsJson(AnnotationService.findTasksOf(user, isFinished, limit), user)
    } yield {
      JsArray(tasksAnnotations.flatten)
    }
  }
}
