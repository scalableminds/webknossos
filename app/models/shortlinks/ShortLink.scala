package models.shortlinks

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables
import com.scalableminds.webknossos.schema.Tables.{Shortlinks, ShortlinksRow}
import play.api.libs.json.{Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class ShortLink(_id: ObjectId, key: String, longLink: String)

object ShortLink {
  implicit val jsonFormat: OFormat[ShortLink] = Json.format[ShortLink]
}

class ShortLinkDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[ShortLink, ShortlinksRow, Shortlinks](sqlClient) {
  val collection = Shortlinks

  def idColumn(x: Shortlinks): Rep[String] = x._Id

  override def isDeletedColumn(x: Tables.Shortlinks): Rep[Boolean] = false

  def parse(r: ShortlinksRow): Fox[ShortLink] =
    Fox.successful(
      ShortLink(
        ObjectId(r._Id),
        r.key,
        r.longlink
      )
    )

  def insertOne(sl: ShortLink): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.shortLinks(_id, key, longlink)
                         values(${sl._id}, ${sl.key}, ${sl.longLink})""")
    } yield ()

  def findOne(id: String): Fox[ShortLink] =
    for {
      r <- run(sql"select #$columns from webknossos.shortLinks where id = $id".as[ShortlinksRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def findOneByKey(key: String): Fox[ShortLink] =
    for {
      r <- run(sql"select #$columns from webknossos.shortLinks where key = $key".as[ShortlinksRow])
      parsed <- parseFirst(r, key)
    } yield parsed

}
