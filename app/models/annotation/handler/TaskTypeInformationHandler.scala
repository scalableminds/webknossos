package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.task.{TaskDAO, TaskTypeDAO}
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import models.annotation.AnnotationState._
import utils.ObjectId


object TaskTypeInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  override def provideAnnotation(taskTypeId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      taskType <- TaskTypeDAO.findOne(taskTypeId) ?~> "taskType.notFound"
      tasks <- TaskDAO.findAllByTaskType(taskType._id)
      annotations <- Fox.serialCombined(tasks)(_.annotations).map(_.flatten).toFox
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "taskType.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      _dataSet = finishedAnnotations.head._dataSet
      mergedAnnotation <- AnnotationMerger.mergeN(taskTypeId, persistTracing=false, user._id,
        _dataSet, taskType._team, AnnotationTypeSQL.CompoundTaskType, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  override def restrictionsFor(taskTypeId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      taskType <- TaskTypeDAO.findOne(taskTypeId) ?~> "taskType.notFound"
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(userOption: Option[User]): Fox[Boolean] =
          (for {
            user <- userOption.toFox
            allowed <- user.isTeamManagerOrAdminOf(taskType._team)
          } yield allowed).orElse(Fox.successful(false))
      }
    }
}
