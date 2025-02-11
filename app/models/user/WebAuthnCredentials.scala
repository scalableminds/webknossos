import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId;
import com.scalableminds.util.tools.Fox;
import com.scalableminds.webknossos.schema.Tables._;

import utils.sql.{SQLDAO, SqlClient};

import javax.inject.Inject;
import scala.concurrent.{ExecutionContext, Future}

case class WebAuthnCredential(
  _id: ObjectId,
  _multiUser: ObjectId,
  name: String,
  publicKeyCose: Array[Byte],
  signatureCount: Int,
)

class WebAuthnCredentialDAO @Inject()(sqlClient: SqlClient) (implicit ec: ExecutionContext)
  extends SQLDAO[WebAuthnCredential, WebauthncredentialsRow, Webauthncredentials](sqlClient) {
    protected val collection = Webauthncredentials

    protected def parse(r: WebauthncredentialsRow): Fox[WebAuthnCredential] =
        Fox.future2Fox(Future.successful(
          WebAuthnCredential(
            ObjectId(r._Id),
            ObjectId(r._Multiuser),
            r.name,
            r.publickeycose,
            r.signaturecount,
          )
        ))

  def insertOne(c: WebAuthnCredential)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.webauthnCredentials(_id, _multiUser,
                                                              name, publicKeyCose,
                                                              signatureCount)
                       VALUES(${c._id}, ${c._multiUser}, ${c.name},
                              ${c.publicKeyCose}, ${c.signatureCount})""".asUpdate)
    } yield ()

  def removeById(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.webauthnCredentials WHERE _id = ${id}""".asUpdate)
    } yield()
}
