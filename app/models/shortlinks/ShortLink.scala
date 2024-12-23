package models.shortlinks

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables
import com.scalableminds.webknossos.schema.Tables.{Shortlinks, ShortlinksRow}
import play.api.libs.json.{Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SqlClient, SQLDAO}
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ShortLink(_id: ObjectId, key: String, longLink: String)

object ShortLink {
  implicit val jsonFormat: OFormat[ShortLink] = Json.format[ShortLink]
}

class ShortLinkDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[ShortLink, ShortlinksRow, Shortlinks](sqlClient) {
  protected val collection = Shortlinks

  protected def idColumn(x: Shortlinks): Rep[String] = x._Id

  override protected def isDeletedColumn(x: Tables.Shortlinks): Rep[Boolean] = false

  protected def parse(r: ShortlinksRow): Fox[ShortLink] =
    Fox.successful(
      ShortLink(
        ObjectId(r._Id),
        r.key,
        r.longlink
      )
    )

  def insertOne(sl: ShortLink): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.shortLinks(_id, key, longlink)
                   VALUES(${sl._id}, ${sl.key}, ${sl.longLink})""".asUpdate)
    } yield ()

  def findOne(id: String): Fox[ShortLink] =
    for {
      r <- run(q"SELECT $columns FROM webknossos.shortLinks WHERE id = $id".as[ShortlinksRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def findOneByKey(key: String): Fox[ShortLink] =
    for {
      r <- run(q"SELECT $columns FROM webknossos.shortLinks WHERE key = $key".as[ShortlinksRow])
      parsed <- parseFirst(r, key)
    } yield parsed

}
