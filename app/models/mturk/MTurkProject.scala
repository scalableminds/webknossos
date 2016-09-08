package models.mturk

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}

/**
  * one-to-one mapping of a collection of HITs on mturk to a webknossos project. This forms the connection so we can
  * keep track which tasks on mturk belong to which project on WK
  *
  * @param _project                webknossos project reference
  * @param hitTypeId               HIT type id on mturk
  * @param team                    team on wk
  * @param numberOfOpenAssignments currently open assignments for this project on mturk
  */
case class MTurkProject(_project: String, hitTypeId: String, team: String, numberOfOpenAssignments: Int)

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

  def increaseNumberOfOpen(_project: String, inc: Int)(implicit ctx: DBAccessContext) = {
    update(Json.obj("_project" -> _project), Json.obj("$inc" -> Json.obj("numberOfOpenAssignments" -> inc)))
  }

  def decreaseNumberOfOpen(_project: String, dec: Int)(implicit ctx: DBAccessContext) = {
    increaseNumberOfOpen(_project, -dec)
  }
}
