package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.project.ProjectSQLDAO
import models.user.UserSQL

import scala.concurrent.ExecutionContext.Implicits.global
import utils.ObjectId

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  override def provideAnnotation(projectId: ObjectId, userOpt: Option[UserSQL])(implicit ctx: DBAccessContext): Fox[AnnotationSQL] =
  {
    for {
      project <- ProjectSQLDAO.findOne(projectId) ?~> "project.notFound"
      annotations <- AnnotationSQLDAO.findAllFinishedForProject(project._id)
      _ <- assertAllOnSameDataset(annotations)
      _ <- assertNonEmpty(annotations) ?~> "project.noAnnotations"
      user <- userOpt ?~> "user.notAuthorised"
      _ <- Fox.assertTrue(user.isTeamManagerOrAdminOf(project._team))
      _dataSet = annotations.head._dataSet
      mergedAnnotation <- AnnotationMerger.mergeN(projectId, persistTracing=false, user._id,
        _dataSet, project._team, AnnotationTypeSQL.CompoundProject, annotations) ?~> "annotation.merge.failed.compound"
    } yield mergedAnnotation
  }

  override def restrictionsFor(projectId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      project <- ProjectSQLDAO.findOne(projectId)
    } yield {
      new AnnotationRestrictions {
        override def allowAccess(userOption: Option[UserSQL]): Fox[Boolean] =
          (for {
            user <- userOption.toFox
            allowed <- user.isTeamManagerOrAdminOf(project._team)
          } yield allowed).orElse(Fox.successful(false))
      }
    }
}
