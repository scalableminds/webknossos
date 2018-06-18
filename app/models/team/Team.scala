package models.team


import com.scalableminds.util.reactivemongo.DBAccessContext
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
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

import scala.concurrent.Future


case class TeamSQL(
                  _id: ObjectId,
                  _organization: ObjectId,
                  name: String,
                  isOrganizationTeam: Boolean = false,
                  created: Long = System.currentTimeMillis(),
                  isDeleted: Boolean = false
                  )

object TeamSQL {
  def fromTeam(t: Team)(implicit ctx: DBAccessContext): Fox[TeamSQL] = {
    for {
      organization <- OrganizationSQLDAO.findOneByName(t.organization)
      organizationTeamId <- OrganizationSQLDAO.findOrganizationTeamId(organization._id)
      teamId = ObjectId.fromBsonId(t._id)
    } yield {
      TeamSQL(
        teamId,
        organization._id,
        t.name,
        organizationTeamId == teamId,
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
      ObjectId(r._Organization),
      r.name,
      r.isorganizationteam,
      r.created.getTime,
      r.isdeleted
    ))
  }

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""(_id in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')
       or _organization in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"""(not isorganizationteam
          and _organization in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[TeamSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[TeamsRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[TeamSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where name = ${name} and #${accessQuery}".as[TeamsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[TeamSQL]] = {
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where #${accessQuery}".as[TeamsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findAllEditable(implicit ctx: DBAccessContext): Fox[List[TeamSQL]] = {
    for {
      requestingUserId <- userIdFromCtx
      accessQuery <- readAccessQuery
      r <- run(sql"""select #${columns} from #${existingCollectionName}
                     where (_id in (select _team from webknossos.user_team_roles where _user = ${requestingUserId.id} and isTeamManager)
                           or _organization in (select _organization from webknossos.users_ where _id = ${requestingUserId.id} and isAdmin))
                     and #${accessQuery}""".as[TeamsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findAllByOrganization(organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TeamSQL]] = {
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where _organization = ${organizationId.id} and #${accessQuery}".as[TeamsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def insertOne(t: TeamSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      r <- run(
        sqlu"""insert into webknossos.teams(_id, _organization, name, created, isOrganizationTeam, isDeleted)
                  values(${t._id.id}, ${t._organization.id}, ${t.name}, ${new java.sql.Timestamp(t.created)}, ${t.isOrganizationTeam}, ${t.isDeleted})
            """)
    } yield ()

}




case class Team(name: String,
                organization: String,
                _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  def couldBeAdministratedBy(user: User) =
    user.organization == organization

  def isAdminOfOrganization(user: User) =
    user.organization == organization && user.isAdmin
}

object Team extends FoxImplicits {

  def teamPublicWrites(team: Team)(implicit ctx: DBAccessContext): Future[JsObject] =
    Future.successful(
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "organization" -> team.organization
      )
    )

  def teamPublicReads(requestingUser: User): Reads[Team] =
    ((__ \ "name").read[String](Reads.minLength[String](3)) and
      (__ \ "organization").read[String](Reads.minLength[String](3))
      ) ((name, organization) => Team(name, organization))

  def teamReadsName(): Reads[String] =
    (__ \ "name").read[String]

  def fromTeamSQL(t: TeamSQL)(implicit ctx: DBAccessContext) = {
    for {
      idBson <- t._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId")
      organization <- OrganizationSQLDAO.findOne(t._organization)
    } yield {
      Team(
        t.name,
        organization.name,
        idBson
      )
    }
  }
}

object TeamService {
  def create(team: Team, user: User)(implicit ctx: DBAccessContext) =
    for {
      _ <- TeamDAO.insert(team)
    } yield ()

  def remove(team: Team)(implicit ctx: DBAccessContext) =
    TeamDAO.removeById(team._id)
}

object TeamDAO {

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[Team] =
    for {
      teamSQL <- TeamSQLDAO.findOne(ObjectId(id))
      team <- Team.fromTeamSQL(teamSQL)
    } yield team

  def findOneById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Team] =
    findOneById(id.stringify)

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[Team] =
    for {
      teamSQL <- TeamSQLDAO.findOneByName(name: String)
      team <- Team.fromTeamSQL(teamSQL)
    } yield team

  def insert(team: Team)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      teamSQL <- TeamSQL.fromTeam(team)
      _ <- TeamSQLDAO.insertOne(teamSQL)
    } yield ()

  def findAll(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teamsSQL <- TeamSQLDAO.findAll
      teams <- Fox.combined(teamsSQL.map(Team.fromTeamSQL(_)))
    } yield teams

  def findAllEditable(implicit ctx: DBAccessContext): Fox[List[Team]] =
    for {
      teamsSQL <- TeamSQLDAO.findAllEditable
      teams <- Fox.combined(teamsSQL.map(Team.fromTeamSQL(_)))
    } yield teams

  def removeById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Unit] =
    TeamSQLDAO.deleteOne(ObjectId.fromBsonId(id))
}
