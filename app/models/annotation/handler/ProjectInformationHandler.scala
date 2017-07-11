package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationRestrictions}
import models.project.Project
import models.team.Role
import models.user.User
import scala.concurrent.ExecutionContext.Implicits.global

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def projectAnnotationRestrictions(project: Project) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap(_.roleInTeam(project.team)).contains(Role.Admin)
    }

  def provideAnnotation(projectName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] = Fox.empty //TODO: rocksDB
  /*{
    for {
      project <- ProjectDAO.findOneByName(projectName) ?~> "project.notFound"
      annotation <- CompoundAnnotation.createFromProject(project, user.map(_._id)) ?~> "project.noAnnotation"
    } yield {
      annotation.copy(restrictions = projectAnnotationRestrictions(project))
    }
  }*/
}
