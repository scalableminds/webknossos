package models.annotation.handler

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.annotation._
import models.task.TaskDAO
import models.user.{User, UserService}
import models.annotation.AnnotationState._
import models.project.ProjectDAO
import com.scalableminds.util.objectid.ObjectId
import models.dataset.{DatasetDAO, DatasetService}

import scala.concurrent.ExecutionContext

class TaskInformationHandler @Inject()(
    taskDAO: TaskDAO,
    annotationDAO: AnnotationDAO,
    userService: UserService,
    annotationMerger: AnnotationMerger,
    projectDAO: ProjectDAO,
    val datasetService: DatasetService,
    val datasetDAO: DatasetDAO,
    val annotationDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler
    with FoxImplicits {

  override def provideAnnotation(taskId: ObjectId, userOpt: Option[User])(
      using ctx: DBAccessContext): Fox[Annotation] =
    for {
      task <- taskDAO.findOne(taskId) ?~> Msg.Task.notFound(taskId)
      annotations <- annotationDAO.findAllByTaskIdAndType(task._id, AnnotationType.Task)
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> Msg.Task.noAnnotations
      user <- userOpt.toFox ?~> Msg.User.notAuthenticated
      project <- projectDAO.findOne(task._project)
      datasetId <- finishedAnnotations.headOption.map(_._dataset).toFox
      _ <- registerDataSourceInTemporaryStore(taskId, datasetId)
      taskBoundingBoxes <- taskDAO.findTaskBoundingBoxesByAnnotationIds(annotations.map(_._id))
      mergedAnnotation <- annotationMerger.mergeN(
        task._id,
        toTemporaryStore = true,
        user._id,
        datasetId,
        AnnotationType.CompoundTask,
        finishedAnnotations,
        taskBoundingBoxes,
        remapSegmentIds = true
      ) ?~> Msg.Annotation.Merge.failedCompound
    } yield mergedAnnotation

  def restrictionsFor(taskId: ObjectId)(using ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      task <- taskDAO.findOne(taskId) ?~> Msg.Task.notFound(taskId)
      project <- projectDAO.findOne(task._project)
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(userOption: Option[User]): Fox[Boolean] =
          (for {
            user <- userOption.toFox
            allowed <- userService.isTeamManagerOrAdminOf(user, project._team)
          } yield allowed).orElse(Fox.successful(false))
      }
    }
}
