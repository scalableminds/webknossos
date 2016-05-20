package oxalis.annotation.handler

import net.liftweb.common.Box
import models.task.{ProjectDAO, Project}
import models.user.User
import models.annotation.{CompoundAnnotation, AnnotationRestrictions, TemporaryAnnotation}
import com.scalableminds.util.reactivemongo.DBAccessContext
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import models.team.Role

object ProjectInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  import com.scalableminds.util.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def projectAnnotationRestrictions(project: Project) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) =
        user.flatMap( _.roleInTeam(project.team)).contains(Role.Admin)
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
