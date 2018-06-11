package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.task.TaskDAO
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import models.annotation.AnnotationState._
import models.project.ProjectSQLDAO

object TaskInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(taskId: String, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      task <- TaskDAO.findOneById(taskId) ?~> "task.notFound"
      annotations <- task.annotations
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "task.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      project <- ProjectSQLDAO.findOneByName(task._project)
      teamIdBson <- project._team.toBSONObjectId.toFox
      dataSetName = finishedAnnotations.head.dataSetName
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(task.id), persistTracing=false, user._id,
        dataSetName, teamIdBson, AnnotationType.CompoundTask, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  def restrictionsFor(taskId: String)(implicit ctx: DBAccessContext) =
    for {
      task <- TaskDAO.findOneById(taskId) ?~> "task.notFound"
      project <- ProjectSQLDAO.findOneByName(task._project)
      teamIdBson <- project._team.toBSONObjectId.toFox
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.exists(_.isTeamManagerOfBLOCKING(teamIdBson))
      }
    }
}
