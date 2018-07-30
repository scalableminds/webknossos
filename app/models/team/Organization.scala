package models.team

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

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
                          ) {

  def organizationTeamId(implicit ctx: DBAccessContext): Fox[ObjectId] =
    OrganizationDAO.findOrganizationTeamId(_id)

  def teamIds(implicit ctx: DBAccessContext): Fox[List[ObjectId]] =
    TeamDAO.findAllIdsByOrganization(_id)

  def publicWrites(implicit ctx: DBAccessContext): Fox[JsObject] = {
    Fox.successful(Json.obj(
      "id" -> _id.toString,
      "name" -> name,
      "additionalInformation" -> additionalInformation,
      "displayName" -> displayName
    ))
  }
}

object OrganizationDAO extends SQLDAO[Organization, OrganizationsRow, Organizations] {
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
