package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.handler.TaskInformationHandler.assertAllOnSameDataset
import models.annotation.{Annotation, AnnotationMerger, AnnotationRestrictions, AnnotationType}
import models.task.{TaskDAO, TaskType, TaskTypeDAO}
import models.team.Role
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future

object TaskTypeInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(taskTypeId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> "taskType.notFound"
      tasks <- TaskDAO.findAllByTaskType(taskType._id)
      annotations <- Future.traverse(tasks)(_.annotations).map(_.flatten).toFox
      finishedAnnotations = annotations.filter(_.state.isFinished)
      _ <- assertAllOnSameDataset(annotations)
      dataSetName = finishedAnnotations.head.dataSetName
      mergedAnnotation <- AnnotationMerger.mergeN(BSONObjectID(taskType.id), persistTracing=false, user.map(_._id),
        dataSetName, taskType.team, AnnotationType.CompoundTaskType, annotations) ?~> "project.noAnnotation"
    } yield mergedAnnotation


  def restrictionsFor(taskTypeId: String)(implicit ctx: DBAccessContext) =
    for {
      taskType <- TaskTypeDAO.findOneById(taskTypeId) ?~> "taskType.notFound"
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(user: Option[User]) =
          user.flatMap(_.roleInTeam(taskType.team)).contains(Role.Admin)
      }
    }
}
