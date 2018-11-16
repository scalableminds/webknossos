package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation._
import models.project.ProjectDAO
import models.user.{User, UserService}

import utils.ObjectId

import scala.concurrent.ExecutionContext

class ProjectInformationHandler @Inject()(annotationDAO: AnnotationDAO,
                                          projectDAO: ProjectDAO,
                                          userService: UserService,
                                          annotationMerger: AnnotationMerger)(implicit val ec: ExecutionContext)
    extends AnnotationInformationHandler
    with FoxImplicits {

  override def provideAnnotation(projectId: ObjectId, userOpt: Option[User])(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      project <- projectDAO.findOne(projectId) ?~> "project.notFound"
      annotations <- annotationDAO.findAllFinishedForProject(project._id)
      _ <- assertAllOnSameDataset(annotations)
      _ <- assertNonEmpty(annotations) ?~> "project.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(user, project._team))
      _dataSet <- annotations.headOption.map(_._dataSet).toFox
      mergedAnnotation <- annotationMerger.mergeN(projectId,
                                                  persistTracing = false,
                                                  user._id,
                                                  _dataSet,
                                                  project._team,
                                                  AnnotationType.CompoundProject,
                                                  annotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation

  override def restrictionsFor(projectId: ObjectId)(implicit ctx: DBAccessContext) =
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
