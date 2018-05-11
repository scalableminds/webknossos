package models.team

import com.scalableminds.util.reactivemongo.{DBAccessContext, JsonFormatHelper}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.user.User
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

import scala.concurrent.Future

case class OrganizationSQL(
                            _id: ObjectId,
                            _organizationTeam: ObjectId,
                            name: String,
                            created: Long = System.currentTimeMillis(),
                            isDeleted: Boolean = false)


object OrganizationSQL {
  def fromOrganization(o: Organization)(implicit ctx: DBAccessContext): Fox[OrganizationSQL] = {
    Fox.successful(
      OrganizationSQL(
        ObjectId.fromBsonId(o._id),
        ObjectId.fromBsonId(o._organizationTeam),
        o.name
      )
    )
  }
}

object OrganizationSQLDAO extends SQLDAO[OrganizationSQL, OrganizationsRow, Organizations] {
  val collection = Organizations

  def idColumn(x: Organizations): Rep[String] = x._Id
  def isDeletedColumn(x: Organizations): Rep[Boolean] = x.isdeleted

  def parse(r: OrganizationsRow): Fox[OrganizationSQL] = {
    Fox.successful(OrganizationSQL(
      ObjectId(r._Id),
      ObjectId(r._Organizationteam),
      r.name,
      r.created.getTime,
      r.isdeleted)
    )
  }

  override def readAccessQ(requestingUserId: ObjectId) =
    s"(_id in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}'))"

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[OrganizationSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where name = ${name} and #${accessQuery}".as[OrganizationsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def insertOne(o: OrganizationSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      r <- run(
        sqlu"""insert into webknossos.organizations(_id, _organizationTeam, name, created, isDeleted)
                  values(${o._id.id}, ${o._organizationTeam.id}, ${o.name}, ${new java.sql.Timestamp(o.created)}, ${o.isDeleted})
            """)
    } yield ()

}


case class Organization(
                         name: String,
                         teams: List[BSONObjectID],
                         _organizationTeam: BSONObjectID,
                         _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify
  lazy val organizationTeam = _organizationTeam.stringify
}

object Organization extends FoxImplicits {

  val organizationFormat = Json.format[Organization]

  def organizationPublicWrites(organization: Organization, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      teams <- Fox.combined(organization.teams.map(TeamDAO.findOneById(_).map(_.name))).futureBox
    } yield {
      Json.obj(
        "id" -> organization.id,
        "name" -> organization.name,
        "teams" -> teams.toOption,
        "organizationTeam" -> organization.organizationTeam)
    }

  def organizationPublicWritesBasic(organization: Organization)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      teams <- Fox.combined(organization.teams.map(TeamDAO.findOneById(_).map(_.name))).futureBox
    } yield {
      Json.obj(
        "id" -> organization.id,
        "name" -> organization.name,
        "teams" -> teams.toOption,
        "organizationTeam" -> organization.organizationTeam)
    }

  def organizationsPublicReads(requestingUser: User): Reads[Organization] =
    ((__ \ "name").read[String](Reads.minLength[String](3)) and
      (__ \ "teams").read[List[BSONObjectID]] and
      (__ \ "organizationTeam").read[String](JsonFormatHelper.StringObjectIdReads("organizationTeam"))
      ) ((name, teams, organizationTeam) => Organization(name, teams, BSONObjectID(organizationTeam)))

  def fromOrganizationSQL(o: OrganizationSQL)(implicit ctx: DBAccessContext) = {
    for {
      idBson <- o._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId")
      organizationTeamIdBson <- o._organizationTeam.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId")
      teams <- TeamSQLDAO.findAllByOrganization(o._id)
      teamBsonIds <- Fox.combined(teams.map(_._id.toBSONObjectId.toFox))
    } yield {
      Organization(
        o.name,
        teamBsonIds,
        organizationTeamIdBson,
        idBson
      )
    }
  }
}

object OrganizationDAO {

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    for {
      organizationSQL <- OrganizationSQLDAO.findOneByName(name)
      organization <- Organization.fromOrganizationSQL(organizationSQL)
    } yield organization

  def findAll(implicit ctx: DBAccessContext): Fox[List[Organization]] =
    for {
      organizationsSQL <- OrganizationSQLDAO.findAll
      organizations <- Fox.combined(organizationsSQL.map(Organization.fromOrganizationSQL(_)))
    } yield organizations

  def insert(o: Organization)(implicit ctx: DBAccessContext) =
    for {
      organizationSQL <- OrganizationSQL.fromOrganization(o)
      _ <- OrganizationSQLDAO.insertOne(organizationSQL)
    } yield ()
}
