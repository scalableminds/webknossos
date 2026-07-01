package models.annotation.handler

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox

import javax.inject.Inject
import models.annotation._
import models.project.ProjectDAO
import models.user.{User, UserService}
import com.scalableminds.util.objectid.ObjectId
import models.dataset.{DatasetDAO, DatasetService}
import models.task.TaskDAO

import scala.concurrent.ExecutionContext

class ProjectInformationHandler @Inject() (
    annotationDAO: AnnotationDAO,
    projectDAO: ProjectDAO,
    userService: UserService,
    annotationMerger: AnnotationMerger,
    taskDAO: TaskDAO,
    val datasetService: DatasetService,
    val datasetDAO: DatasetDAO,
    val annotationDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore
)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler {

  override def provideAnnotation(projectId: ObjectId, userOpt: Option[User])(using
      ctx: DBAccessContext
  ): Fox[Annotation] =
    for {
      project <- projectDAO.findOne(projectId) ?~> Msg.Project.notFound(projectId)
      user <- userOpt.toFox ?~> Msg.User.notAuthenticated
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team))
      annotations <- annotationDAO.findAllFinishedForProject(project._id)
      _ <- assertAllOnSameDataset(annotations)
      _ <- assertNonEmpty(annotations) ?~> Msg.Project.noAnnotations
      datasetId <- annotations.headOption.map(_._dataset).toFox
      _ <- registerDataSourceInTemporaryStore(projectId, datasetId)
      taskBoundingBoxes <- taskDAO.findTaskBoundingBoxesByAnnotationIds(annotations.map(_._id))
      mergedAnnotation <- annotationMerger.mergeN(
        projectId,
        toTemporaryStore = true,
        user._id,
        datasetId,
        AnnotationType.CompoundProject,
        annotations,
        taskBoundingBoxes
      ) ?~> Msg.Annotation.Merge.failedCompound
    } yield mergedAnnotation

  override def restrictionsFor(projectId: ObjectId)(using ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      project <- projectDAO.findOne(projectId)
    } yield new AnnotationRestrictions {
      override def allowAccess(userOption: Option[User]): Fox[Boolean] =
        (for {
          user <- userOption.toFox
          allowed <- userService.isTeamManagerOrAdminOf(user, project._team)
        } yield allowed).orElse(Fox.successful(false))
    }
}
