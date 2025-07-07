package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.annotation._
import models.project.ProjectDAO
import models.user.{User, UserService}
import com.scalableminds.util.objectid.ObjectId
import models.task.TaskDAO

import scala.concurrent.ExecutionContext

class ProjectInformationHandler @Inject()(annotationDAO: AnnotationDAO,
                                          projectDAO: ProjectDAO,
                                          taskDAO: TaskDAO,
                                          userService: UserService,
                                          annotationMerger: AnnotationMerger)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler
    with FoxImplicits {

  override def provideAnnotation(projectId: ObjectId, userOpt: Option[User])(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      project <- projectDAO.findOne(projectId) ?~> "project.notFound"
      user <- userOpt.toFox ?~> "user.notAuthorised"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team))
      annotations <- annotationDAO.findAllFinishedForProject(project._id)
      _ <- assertAllOnSameDataset(annotations)
      _ <- assertNonEmpty(annotations) ?~> "project.noAnnotations"
      datasetId <- annotations.headOption.map(_._dataset).toFox
      taskBoundingBoxes <- taskDAO.findTaskBoundingBoxesByAnnotationIds(annotations.map(_._id))
      mergedAnnotation <- annotationMerger.mergeN(projectId,
                                                  toTemporaryStore = true,
                                                  user._id,
                                                  datasetId,
                                                  project._team,
                                                  AnnotationType.CompoundProject,
                                                  annotations,
                                                  taskBoundingBoxes) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  override def restrictionsFor(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      project <- projectDAO.findOne(projectId)
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
