package models.mturk

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}

case class MTurkProject(_project: String, hittypeId: String, team: String)

object MTurkProject extends FoxImplicits {
  implicit val mturkProjectFormat = Json.format[MTurkProject]
}

object MTurkProjectDAO extends SecuredBaseDAO[MTurkProject] with FoxImplicits {

  val collectionName = "mturkProjects"

  val formatter = MTurkProject.mturkProjectFormat

  underlying.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))

  override val AccessDefinitions = new DefaultAccessDefinitions {

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _                =>
          DenyEveryone()
      }
    }
  }

  def removeByProject(_project: String)(implicit ctx: DBAccessContext) = {
    remove(Json.obj("_project" -> _project))
  }

  def findByProject(_project: String)(implicit ctx: DBAccessContext) = {
    findOne(Json.obj("_project" -> _project))
  }
}
