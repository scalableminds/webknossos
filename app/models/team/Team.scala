package models.team

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.basics.SecuredBaseDAO
import models.user.{User, UserDAO}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

import scala.concurrent.Future


case class TeamSQL(
                  _id: ObjectId,
                  _owner: ObjectId,
                  _parent: Option[ObjectId],
                  name: String,
                  behavesLikeRootTeam: Option[Boolean] = None,
                  created: Long = System.currentTimeMillis(),
                  isDeleted: Boolean = false
                  )

object TeamSQLDAO extends SQLDAO[TeamSQL, TeamsRow, Teams] {
  val collection = Teams

  def idColumn(x: Teams): Rep[String] = x._Id
  def isDeletedColumn(x: Teams): Rep[Boolean] = x.isdeleted

  def parse(r: TeamsRow): Fox[TeamSQL] =
    Fox.successful(TeamSQL(
      ObjectId(r._Id),
      ObjectId(r._Owner),
      r._Parent.map(ObjectId(_)),
      r.name,
      r.behaveslikerootteam,
      r.created.getTime,
      r.isdeleted
    ))
}




case class Team(
  name: String,
  parent: Option[String],
  roles: List[Role],
  owner: Option[BSONObjectID] = None,
  behavesLikeRootTeam: Option[Boolean] = None,
  _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  def isEditableBy(user: User) =
    user.isAdminOf(name) || parent.exists(user.isAdminOf)

  def isOwner(user: User) =
    owner.contains(user._id)

  def couldBeAdministratedBy(user: User) =
    parent.forall(user.teamNames.contains)

  def isRootTeam =
    behavesLikeRootTeam.getOrElse(parent.isEmpty)
}

object Team extends FoxImplicits {

  val teamFormat = Json.format[Team]

  def teamPublicWrites(team: Team, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      owner <- team.owner.toFox.flatMap(UserDAO.findOneById(_).map(User.userCompactWrites.writes)).futureBox
    } yield {
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "parent" -> team.parent,
        "roles" -> team.roles,
        "owner" -> owner.toOption
      )
    }

  def teamPublicWritesBasic(team: Team)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      owner <- team.owner.toFox.flatMap(UserDAO.findOneById(_).map(User.userCompactWrites.writes)).futureBox
    } yield {
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "parent" -> team.parent,
        "roles" -> team.roles,
        "owner" -> owner.toOption
      )
    }

  def teamPublicReads(requestingUser: User): Reads[Team] =
    ((__ \ "name").read[String](Reads.minLength[String](3)) and
      (__ \ "roles").read[List[Role]] and
      (__ \ "parent").readNullable(Reads.minLength[String](3))
      )((name, roles, parent) => Team(name, parent, roles, Some(requestingUser._id)))
}

object TeamService {
  def create(team: Team, user: User)(implicit ctx: DBAccessContext) = {
    UserDAO.addTeam(user._id, TeamMembership(team.name, Role.Admin))
    TeamDAO.insert(team)
  }

  def remove(team: Team)(implicit ctx: DBAccessContext) = {
    TeamDAO.removeById(team._id)
  }

  def rootTeams() = {
    TeamDAO.findRootTeams()(GlobalAccessContext)
  }
}

object TeamDAO extends SecuredBaseDAO[Team] with FoxImplicits {
  val collectionName = "teams"

  implicit val formatter = Team.teamFormat

  override val AccessDefinitions = new DefaultAccessDefinitions{

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj(
            "$or" -> Json.arr(
              Json.obj("name" -> Json.obj("$in" -> user.teamNames)),
              Json.obj("parent"-> Json.obj("$in" -> user.teamNames)))
          ))
        case _ =>
          DenyEveryone()
      }
    }
  }

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)

  def findRootTeams()(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj("$or" -> Json.arr(
      Json.obj("behavesLikeRootTeam" -> true),
      Json.obj("parent" -> Json.obj("$exists" -> false)))
    )).cursor[Team]().collect[List]()
  }
}
