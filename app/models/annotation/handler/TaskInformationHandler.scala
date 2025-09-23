package models.annotation.handler

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
import play.api.i18n.MessagesProvider

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

  override def provideAnnotation(taskId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext,
                                                                          mp: MessagesProvider): Fox[Annotation] =
    for {
      task <- taskDAO.findOne(taskId) ?~> "task.notFound"
      annotations <- annotationDAO.findAllByTaskIdAndType(task._id, AnnotationType.Task)
      finishedAnnotations = annotations.filter(_.state == Finished)
      _ <- assertAllOnSameDataset(finishedAnnotations)
      _ <- assertNonEmpty(finishedAnnotations) ?~> "task.noAnnotations"
      user <- userOpt.toFox ?~> "user.notAuthorised"
      project <- projectDAO.findOne(task._project)
      datasetId <- finishedAnnotations.headOption.map(_._dataset).toFox
      _ <- registerDataSourceInTemporaryStore(taskId, datasetId)
      taskBoundingBoxes <- taskDAO.findTaskBoundingBoxesByAnnotationIds(annotations.map(_._id))
      mergedAnnotation <- annotationMerger.mergeN(task._id,
                                                  toTemporaryStore = true,
                                                  user._id,
                                                  datasetId,
                                                  project._team,
                                                  AnnotationType.CompoundTask,
                                                  finishedAnnotations,
                                                  taskBoundingBoxes) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  def restrictionsFor(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      task <- taskDAO.findOne(taskId) ?~> "task.notFound"
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
