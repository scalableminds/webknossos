package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationRestrictions, CompoundAnnotation, TemporaryAnnotation}
import models.project.{Project, ProjectDAO}
import models.team.Role
import models.user.User

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  type AType = TemporaryAnnotation

  def projectAnnotationRestrictions(project: Project) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap(_.roleInTeam(project.team)).contains(Role.Admin)
    }

  def provideAnnotation(projectName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> "project.notFound"
      annotation <- CompoundAnnotation.createFromProject(project, user.map(_._id)) ?~> "project.noAnnotation"
    } yield {
      annotation.copy(restrictions = projectAnnotationRestrictions(project))
    }
  }
}
