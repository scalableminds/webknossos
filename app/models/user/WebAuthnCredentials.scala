package models.user

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables
import com.scalableminds.webknossos.schema.Tables._
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

case class WebAuthnCredential(
  _id: ObjectId,
  _multiUser: ObjectId,
  name: String,
  publicKeyCose: Array[Byte],
  signatureCount: Int,
  isDeleted: Boolean,
)

class WebAuthnCredentialDAO @Inject()(sqlClient: SqlClient) (implicit ec: ExecutionContext)
  extends SQLDAO[WebAuthnCredential, WebauthncredentialsRow, Webauthncredentials](sqlClient) {
    protected val collection = Webauthncredentials

    override protected def idColumn(x: Webauthncredentials): Rep[String] = x._Id

    override protected def isDeletedColumn(x: Webauthncredentials): Rep[Boolean] = x.isdeleted

    protected def parse(r: WebauthncredentialsRow): Fox[WebAuthnCredential] =
        Fox.successful(
          WebAuthnCredential(
            ObjectId(r._Id),
            ObjectId(r._Multiuser),
            r.name,
            r.publickeycose,
            r.signaturecount,
            r.isdeleted
          )
        )

  def findAllForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[WebAuthnCredential]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _multiUser = $userId AND $accessQuery".as[WebauthncredentialsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findById(id: ObjectId)(implicit ct: DBAccessContext): Fox[WebAuthnCredential] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[WebauthncredentialsRow])
      parsed <- parseFirst(r, id)
    } yield parsed


  def findByIdAndUserId(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[WebAuthnCredential] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND _multiUser = $userId AND $accessQuery".as[WebauthncredentialsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def insertOne(c: WebAuthnCredential): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.webauthnCredentials(_id, _multiUser,
                                                              name, publicKeyCose,
                                                              signatureCount)
                       VALUES(${c._id}, ${c._multiUser}, ${c.name},
                              ${c.publicKeyCose}, ${c.signatureCount})""".asUpdate)
    } yield ()

  def removeById(id: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.webauthnCredentials WHERE _id = ${id}""".asUpdate)
    } yield()

}
