package models.organization

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{GetResultPartnersRow, Partners, PartnersRow}
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
