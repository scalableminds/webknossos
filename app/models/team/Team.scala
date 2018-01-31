package models.team

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.user.{User, UserDAO}
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
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

object TeamSQL {
  def fromTeam(t: Team)(implicit ctx: DBAccessContext): Fox[TeamSQL] = {
    for {
      parentOpt <- t.parent match {
        case Some(p) => for {parentTeam <- TeamSQLDAO.findOneByName(p)} yield {Some(parentTeam)}
        case None => Fox.successful(None)
      }
    } yield {
      TeamSQL(
        ObjectId.fromBsonId(t._id),
        ObjectId.fromBsonId(t.owner),
        parentOpt.map(_._id),
        t.name,
        t.behavesLikeRootTeam,
        System.currentTimeMillis(),
        false
      )
    }
  }
}

object TeamSQLDAO extends SQLDAO[TeamSQL, TeamsRow, Teams] {
  val collection = Teams

  def idColumn(x: Teams): Rep[String] = x._Id
  def isDeletedColumn(x: Teams): Rep[Boolean] = x.isdeleted

  def parse(r: TeamsRow): Fox[TeamSQL] = {
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

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[TeamSQL] =
    for {
      rOpt <- run(Teams.filter(r => notdel(r) && r.name === name).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def findRootTeams(implicit ctx: DBAccessContext): Fox[List[TeamSQL]] =
    for {
      r <- run(Teams.filter(t => notdel(t) && t.behaveslikerootteam).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def insertOne(t: TeamSQL)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      r <- run(
        sqlu"""insert into webknossos.teams(_id, _owner, _parent, name, behavesLikeRootTeam, created, isDeleted)
                  values(${t._id.id}, ${t._owner.id}, ${t._parent.map(_.id)}, ${t.name}, ${t.behavesLikeRootTeam}, ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})
            """)
    } yield ()
  }

}




case class Team(
  name: String,
  parent: Option[String],
  roles: List[Role],
  owner: BSONObjectID,
  behavesLikeRootTeam: Option[Boolean] = None,
  _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  def isEditableBy(user: User) =
    user.isAdminOf(name) || parent.exists(user.isAdminOf)

  def isOwner(user: User) =
    owner == user._id

  def couldBeAdministratedBy(user: User) =
    parent.forall(user.teamNames.contains)

  def isRootTeam =
    behavesLikeRootTeam.getOrElse(parent.isEmpty)
}

object Team extends FoxImplicits {

  val teamFormat = Json.format[Team]

  def teamPublicWrites(team: Team, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      owner <- UserDAO.findOneById(team.owner).map(User.userCompactWrites.writes).futureBox
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
      owner <- UserDAO.findOneById(team.owner).map(User.userCompactWrites.writes).futureBox
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
      )((name, roles, parent) => Team(name, parent, roles, requestingUser._id))


  private def resolveParentTeam(idOpt: Option[ObjectId])(implicit ctx: DBAccessContext): Fox[Option[TeamSQL]] = idOpt match {
    case Some(id) => for {
                      parentTeam <- TeamSQLDAO.findOne(id)
                    } yield {
                      Some(parentTeam)
                    }
    case None => Fox.successful(None)
  }

  def fromTeamSQL(s: TeamSQL)(implicit ctx: DBAccessContext) = {
    for {
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId")
      ownerBsonId <- s._owner.toBSONObjectId.toFox
      parentTeamOpt <- resolveParentTeam(s._parent)
    } yield {
      Team(
        s.name,
        parentTeamOpt.map(_.name),
        List(Role.Admin, Role.User),
        ownerBsonId,
        s.behavesLikeRootTeam,
        idBson
      )
    }
  }
}

object TeamService {
  def create(team: Team, user: User)(implicit ctx: DBAccessContext) = {
    UserDAO.addTeam(user._id, TeamMembership(team.name, Role.Admin))
    TeamDAO.insert(team)
  }

  def remove(team: Team)(implicit ctx: DBAccessContext) = {
    TeamDAO.removeById(team._id)
  }

  def rootTeams =
    TeamDAO.findRootTeams(GlobalAccessContext)
}

object TeamDAO {

/*
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
  }*/

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[Team] =
    for {
      teamSQL <- TeamSQLDAO.findOneByName(name)
      team <- Team.fromTeamSQL(teamSQL)
    } yield team


  def findRootTeams(implicit ctx: DBAccessContext): Fox[List[Team]] = {
    for {
      teamsSQL <- TeamSQLDAO.findRootTeams
      teams <- Fox.combined(teamsSQL.map(Team.fromTeamSQL(_)))
    } yield teams
  }

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[Team] =
    for {
      teamSQL <- TeamSQLDAO.findOne(ObjectId(id))
      team <- Team.fromTeamSQL(teamSQL)
    } yield team

  def insert(team: Team)(implicit ctx: DBAccessContext): Fox[Team] =
    for {
      teamSQL <- TeamSQL.fromTeam(team)
      _ <- TeamSQLDAO.insertOne(teamSQL)
    } yield team

  def findAll(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teamsSQL <- TeamSQLDAO.findAll
      teams <- Fox.combined(teamsSQL.map(Team.fromTeamSQL(_)))
    } yield teams

  def removeById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Unit] =
    TeamSQLDAO.deleteOne(ObjectId.fromBsonId(id))
}
