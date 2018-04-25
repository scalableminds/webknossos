package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.task.TaskDAO
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import models.annotation.AnnotationState._
import models.project.ProjectDAO

object TaskInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(taskId: String, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      task <- TaskDAO.findOneById(taskId) ?~> "task.notFound"
      annotations <- task.annotations
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "task.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      project <- ProjectDAO.findOneByName(task._project)
      dataSetName = finishedAnnotations.head.dataSetName
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(task.id), persistTracing=false, user._id,
        dataSetName, project._team, AnnotationType.CompoundTask, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  def restrictionsFor(taskId: String)(implicit ctx: DBAccessContext) =
    for {
      task <- TaskDAO.findOneById(taskId) ?~> "task.notFound"
      project <- ProjectDAO.findOneByName(task._project)
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.exists(_.isTeamManagerOf(project._team))
      }
    }
}
