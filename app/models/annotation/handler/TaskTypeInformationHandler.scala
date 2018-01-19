package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationMerger, AnnotationRestrictions, AnnotationType}
import models.task.{TaskDAO, TaskTypeDAO}
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import models.annotation.AnnotationState._

import scala.concurrent.Future

object TaskTypeInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(taskTypeId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> "taskType.notFound"
      tasks <- TaskDAO.findAllByTaskType(taskType._id)
      annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten).toFox
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "taskType.noAnnotations"
      dataSetName = finishedAnnotations.head.dataSetName
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(taskType.id), persistTracing=false, user.map(_._id),
        dataSetName, taskType._team, AnnotationType.CompoundTaskType, finishedAnnotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation


  def restrictionsFor(taskTypeId: String)(implicit ctx: DBAccessContext) =
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> "taskType.notFound"
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.exists(_.isSuperVisorOf(taskType._team))
      }
    }
}
