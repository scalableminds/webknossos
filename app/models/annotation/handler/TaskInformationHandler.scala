package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.task.TaskSQLDAO
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import models.annotation.AnnotationState._
import models.project.ProjectSQLDAO
import utils.ObjectId

object TaskInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  override def provideAnnotation(taskId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[AnnotationSQL] =
    for {
      task <- TaskSQLDAO.findOne(taskId) ?~> "task.notFound"
      annotations <- task.annotations
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "task.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      project <- ProjectSQLDAO.findOne(task._project)
      _dataSet = finishedAnnotations.head._dataSet
      mergedAnnotation <- AnnotationMerger.mergeN(task._id, persistTracing=false, ObjectId.fromBsonId(user._id),
        _dataSet, project._team, AnnotationTypeSQL.CompoundTask, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  def restrictionsFor(taskId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      task <- TaskSQLDAO.findOne(taskId) ?~> "task.notFound"
      project <- ProjectSQLDAO.findOne(task._project)
      teamIdBson <- project._team.toBSONObjectId.toFox
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(userOption: Option[User]): Fox[Boolean] =
          (for {
            user <- userOption.toFox
            allowed <- user.isTeamManagerOrAdminOf(teamIdBson)
          } yield allowed).orElse(Fox.successful(false))
      }
    }
}
