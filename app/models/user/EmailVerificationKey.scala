package models.user

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables
import com.scalableminds.webknossos.schema.Tables._
import slick.lifted.{Rep, TableQuery}
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class EmailVerificationKey(
    _id: ObjectId,
    key: String,
    email: String,
    _multiUser: ObjectId,
    validUntil: Option[Instant],
    isUsed: Boolean
)

class EmailVerificationKeyDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[EmailVerificationKey, EmailverificationkeysRow, Emailverificationkeys](sqlClient) {
  override protected def collection: TableQuery[Tables.Emailverificationkeys] = Emailverificationkeys

  override protected def idColumn(x: Tables.Emailverificationkeys): Rep[String] = x._Id

  override protected def isDeletedColumn(x: Tables.Emailverificationkeys): Rep[Boolean] = ???
  protected def getResult = GetResultEmailverificationkeysRow

  override protected def parse(
      row: _root_.com.scalableminds.webknossos.schema.Tables.EmailverificationkeysRow
  ): Fox[EmailVerificationKey] =
    Fox.successful(
      EmailVerificationKey(
        ObjectId(row._Id),
        row.key,
        row.email,
        ObjectId(row._Multiuser),
        row.validuntil.map(Instant.fromSql),
        row.isused
      )
    )

  def insertOne(evk: EmailVerificationKey): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.emailVerificationKeys(_id, key, email, _multiUser, validUntil, isUsed)
                   VALUES(${evk._id}, ${evk.key}, ${evk.email}, ${evk._multiUser}, ${evk.validUntil}, ${evk.isUsed})""".asUpdate
      )
    } yield ()

  def findOneByKey(key: String): Fox[EmailVerificationKey] =
    for {
      r <- run(q"SELECT $columns FROM webknossos.emailVerificationKeys WHERE key = $key".as[EmailverificationkeysRow])
      parsed <- parseFirst(r, key)
    } yield parsed

  def markAsUsed(emailVerificationKeyId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.emailVerificationKeys
                   SET isused = true
                   WHERE _id = $emailVerificationKeyId""".asUpdate)
    } yield ()

}
