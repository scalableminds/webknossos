package models.organization

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.box.{Failure, Full}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.schema.Tables.{GetResultPartnersRow, Partners, PartnersRow}
import play.api.libs.json.{JsObject, Json}
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/* A partner co-brands WEBKNOSSOS for the organizations assigned to it (organizations._partner):
   Their navbar shows the partner logo and they can use the pretrained AI models restricted to the partner. */
case class Partner(
    _id: ObjectId,
    name: String,
    logoUrl: String,
    compactLogoUrl: Option[String], // shown where the navbar is collapsed, falls back to logoUrl
    linkUrl: Option[String],
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

class PartnerService @Inject() (partnerDAO: PartnerDAO)(implicit ec: ExecutionContext) {

  def publicWrites(partner: Partner): JsObject =
    Json.obj(
      "id" -> partner._id,
      "name" -> partner.name,
      "logoUrl" -> partner.logoUrl,
      "compactLogoUrl" -> partner.compactLogoUrl,
      "linkUrl" -> partner.linkUrl
    )

  // Partner branding is not secret, so it is read with GlobalAccessContext to also show it to anonymous users.
  // A partner that cannot be found (e.g. soft-deleted) counts as no partner, so the organization stays readable.
  def findPartnerOf(organization: Organization): Fox[Option[Partner]] =
    Fox
      .runOptional(organization._partner)(partnerId =>
        partnerDAO.findOne(partnerId)(using GlobalAccessContext).shiftBox
      )
      .flatMap {
        case Some(Full(partner)) => Fox.successful(Some(partner))
        case Some(f: Failure)    => f.toFox
        case _                   => Fox.successful(None)
      }
}

class PartnerDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Partner, PartnersRow, Partners](sqlClient) {
  protected val collection = Partners
  protected def resultConverter = GetResultPartnersRow

  protected def parse(r: PartnersRow): Fox[Partner] =
    Fox.successful(
      Partner(
        ObjectId(r._id),
        r.name,
        r.logourl,
        r.compactlogourl,
        r.linkurl,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    )
}
