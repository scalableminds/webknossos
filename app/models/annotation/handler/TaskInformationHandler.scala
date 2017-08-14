package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationMerger, AnnotationRestrictions, AnnotationType}
import models.task.{Task, TaskDAO}
import models.team.Role
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID

object TaskInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(taskId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      task <- TaskDAO.findOneById(taskId) ?~> "task.notFound"
      annotations <- task.annotations
      finishedAnnotations = annotations.filter(_.state.isFinished)
      dataSetName = finishedAnnotations.head.dataSetName
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(task.id), persistTracing=false, user.map(_._id),
        dataSetName, task.team, AnnotationType.CompoundTask, annotations) ?~> "project.noAnnotation"
    } yield mergedAnnotation

  def restrictionsFor(taskId: String)(implicit ctx: DBAccessContext) =
    for {
      task <- TaskDAO.findOneById(taskId) ?~> "task.notFound"
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.flatMap(_.roleInTeam(task.team)) == Some(Role.Admin)
      }
    }
}
