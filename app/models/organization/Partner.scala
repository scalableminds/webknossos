package models.organization

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
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
    linkUrl: Option[String],
    created: Instant = Instant.now,
    isDeleted: Boolean = false
) {
  def publicWrites: JsObject =
    Json.obj(
      "id" -> _id,
      "name" -> name,
      "logoUrl" -> logoUrl,
      "linkUrl" -> linkUrl
    )
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
        r.linkurl,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    )

  def insertOne(p: Partner): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.partners(_id, name, logoUrl, linkUrl, created, isDeleted)
                   VALUES(${p._id}, ${p.name}, ${p.logoUrl}, ${p.linkUrl}, ${p.created}, ${p.isDeleted})""".asUpdate)
    } yield ()
}
