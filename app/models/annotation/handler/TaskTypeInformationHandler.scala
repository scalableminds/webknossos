package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation._
import models.task.{TaskDAO, TaskTypeDAO}
import models.user.{User, UserService}
import models.annotation.AnnotationState._
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

class TaskTypeInformationHandler @Inject()(taskTypeDAO: TaskTypeDAO,
                                           taskDAO: TaskDAO,
                                           userService: UserService,
                                           annotationDAO: AnnotationDAO,
                                           annotationMerger: AnnotationMerger)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler
    with FoxImplicits {

  override def provideAnnotation(taskTypeId: ObjectId, userOpt: Option[User])(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      taskType <- taskTypeDAO.findOne(taskTypeId) ?~> "taskType.notFound"
      tasks <- taskDAO.findAllByTaskType(taskType._id)
      annotations <- Fox
        .serialCombined(tasks)(task => annotationDAO.findAllByTaskIdAndType(task._id, AnnotationType.Task))
        .map(_.flatten)
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "taskType.noAnnotations"
      user <- userOpt.toFox ?~> "user.notAuthorised"
      datasetId <- finishedAnnotations.headOption.map(_._dataset).toFox
      taskBoundingBoxes <- taskDAO.findUniqueTaskBoundingBoxesByAnnotationIds(annotations.map(_._id))
      mergedAnnotation <- annotationMerger.mergeN(taskTypeId,
                                                  toTemporaryStore = true,
                                                  user._id,
                                                  datasetId,
                                                  taskType._team,
                                                  AnnotationType.CompoundTaskType,
                                                  finishedAnnotations,
                                                  taskBoundingBoxes) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  override def restrictionsFor(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      taskType <- taskTypeDAO.findOne(taskTypeId) ?~> "taskType.notFound"
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(userOption: Option[User]): Fox[Boolean] =
          (for {
            user <- userOption.toFox
            allowed <- userService.isTeamManagerOrAdminOf(user, taskType._team)
          } yield allowed).orElse(Fox.successful(false))
      }
    }
}
