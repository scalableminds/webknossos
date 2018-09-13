package models.team

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class Organization(
                            _id: ObjectId,
                            name: String,
                            additionalInformation: String,
                            logoUrl: String,
                            displayName: String,
                            newUserMailingList: String = "",
                            overTimeMailingList: String = "",
                            created: Long = System.currentTimeMillis(),
                            isDeleted: Boolean = false
                          )

class OrganizationService @Inject()(organizationDAO: OrganizationDAO, teamDAO: TeamDAO)(implicit ec: ExecutionContext) {

  def publicWrites(organization: Organization)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    Fox.successful(Json.obj(
      "id" -> organization._id.toString,
      "name" -> organization.name,
      "additionalInformation" -> organization.additionalInformation,
      "displayName" -> organization.displayName
    ))
  }

}

class OrganizationDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SQLDAO[Organization, OrganizationsRow, Organizations](sqlClient) {
  val collection = Organizations

  def idColumn(x: Organizations): Rep[String] = x._Id

  def isDeletedColumn(x: Organizations): Rep[Boolean] = x.isdeleted


  def parse(r: OrganizationsRow): Fox[Organization] =
    Fox.successful(
      Organization(
        ObjectId(r._Id),
        r.name,
        r.additionalinformation,
        r.logourl,
        r.displayname,
        r.newusermailinglist,
        r.overtimemailinglist,
        r.created.getTime,
        r.isdeleted)
    )

  override def readAccessQ(requestingUserId: ObjectId) =
    s"(_id in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}'))"

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[Organization] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where name = ${name} and #${accessQuery}".as[OrganizationsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def insertOne(o: Organization)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      r <- run(

        sqlu"""insert into webknossos.organizations(_id, name, additionalInformation, logoUrl, displayName, newUserMailingList, overTimeMailingList, created, isDeleted)
                  values(${o._id.id}, ${o.name}, ${o.additionalInformation}, ${o.logoUrl}, ${o.displayName}, ${o.newUserMailingList}, ${o.overTimeMailingList}, ${new java.sql.Timestamp(o.created)}, ${o.isDeleted})
            """)
    } yield ()

  def findOrganizationTeamId(o: ObjectId) =
    for{
      r <- run(sql"select _id from webknossos.organizationTeams where _organization = ${o.id}".as[String])
      parsed <- ObjectId.parse(r.head)
    } yield parsed

}
