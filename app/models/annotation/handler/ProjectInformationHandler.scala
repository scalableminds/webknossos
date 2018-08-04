package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.project.ProjectDAO
import models.user.User

import scala.concurrent.ExecutionContext.Implicits.global
import utils.ObjectId

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  override def provideAnnotation(projectId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] =
  {
    for {
      project <- ProjectDAO.findOne(projectId) ?~> "project.notFound"
      annotations <- AnnotationDAO.findAllFinishedForProject(project._id)
      _ <- assertAllOnSameDataset(annotations)
      _ <- assertNonEmpty(annotations) ?~> "project.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      _ <- Fox.assertTrue(user.isTeamManagerOrAdminOf(project._team))
      _dataSet = annotations.head._dataSet
      mergedAnnotation <- AnnotationMerger.mergeN(projectId, persistTracing=false, user._id,
        _dataSet, project._team, AnnotationType.CompoundProject, annotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation
  }

  override def restrictionsFor(projectId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      project <- ProjectDAO.findOne(projectId)
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(userOption: Option[User]): Fox[Boolean] =
          (for {
            user <- userOption.toFox
            allowed <- user.isTeamManagerOrAdminOf(project._team)
          } yield allowed).orElse(Fox.successful(false))
      }
    }
}
