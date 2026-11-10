package oauth

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.schema.Tables.{GetResultOauthgrantsRow, Oauthgrants, OauthgrantsRow}
import utils.sql.{SQLDAO, SimpleSQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/** An MCP client that a user allowed to access WEBKNOSSOS on their behalf, limited to the given scopes. There is at most
  * one live grant per user and client: approving the same client again updates it. Revoking a grant revokes everything
  * issued under it (see OAuthService.revokeGrant).
  *
  * @param clientId
  *   the URL of the client's metadata document, see OAuthClientMetadataService
  * @param scopes
  *   as understood by security.Scope.Set.parse. The consent page offers the permission levels read, write and delete.
  */
case class OAuthGrant(
    _id: ObjectId,
    _user: ObjectId,
    clientId: String,
    clientName: String,
    scopes: String,
    created: Instant = Instant.now,
    lastUsed: Instant = Instant.now,
    isDeleted: Boolean = false
)

class OAuthGrantDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[OAuthGrant, OauthgrantsRow, Oauthgrants](sqlClient) {
  protected val collection = Oauthgrants
  protected def resultConverter = GetResultOauthgrantsRow

  protected def parse(r: OauthgrantsRow): Fox[OAuthGrant] =
    Fox.successful(
      OAuthGrant(
        ObjectId(r._id),
        ObjectId(r._user),
        r.clientid,
        r.clientname,
        r.scopes,
        Instant.fromSql(r.created),
        Instant.fromSql(r.lastused),
        r.isdeleted
      )
    )

  // These deliberately take no DBAccessContext: grants are only ever looked up for a user who is known at that point.
  def findLive(id: ObjectId): Fox[OAuthGrant] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id".as[OauthgrantsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def findLiveByUserAndClient(userId: ObjectId, clientId: String): Fox[OAuthGrant] =
    for {
      r <- run(q"""SELECT $columns FROM $existingCollectionName
                   WHERE _user = $userId AND clientId = $clientId""".as[OauthgrantsRow])
      parsed <- parseFirst(r, "userAndClient")
    } yield parsed

  def findAllLiveByUser(userId: ObjectId): Fox[List[OAuthGrant]] =
    for {
      r <- run(q"""SELECT $columns FROM $existingCollectionName
                   WHERE _user = $userId ORDER BY created DESC""".as[OauthgrantsRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(g: OAuthGrant): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.oauthGrants(_id, _user, clientId, clientName, scopes, created, lastUsed, isDeleted)
                   VALUES(${g._id}, ${g._user}, ${g.clientId}, ${g.clientName}, ${g.scopes},
                          ${g.created}, ${g.lastUsed}, ${g.isDeleted})""".asUpdate)
    } yield ()

  def updateScopesAndClientName(id: ObjectId, scopes: String, clientName: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.oauthGrants SET scopes = $scopes, clientName = $clientName
                   WHERE _id = $id""".asUpdate)
    } yield ()

  // Only written once a minute at most, so that MCP requests do not each cause a write.
  def touch(id: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.oauthGrants SET lastUsed = NOW()
                   WHERE _id = $id AND lastUsed < NOW() - INTERVAL '1 minute'""".asUpdate)
    } yield ()

  def markDeleted(id: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.oauthGrants SET isDeleted = TRUE WHERE _id = $id".asUpdate)
    } yield ()

  def findAllLiveIdsByUsers(userIds: Seq[ObjectId]): Fox[List[ObjectId]] =
    if (userIds.isEmpty) Fox.successful(List.empty)
    else
      for {
        r <- run(q"SELECT _id FROM $existingCollectionName WHERE _user IN ${SqlToken.tupleFromList(userIds.toList)}".as[String])
      } yield r.toList.map(ObjectId(_))
}

/** What an authorization code was issued for. The code itself is only stored as a hash. */
case class OAuthAuthorizationCode(grantId: ObjectId, redirectUri: String, codeChallenge: String)

class OAuthAuthorizationCodeDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def insertOne(codeHash: String, code: OAuthAuthorizationCode, expiresAt: Instant): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.oauthAuthorizationCodes(codeHash, _grant, redirectUri, codeChallenge,
                                                                   expirationDateTime, isUsed)
                   VALUES($codeHash, ${code.grantId}, ${code.redirectUri}, ${code.codeChallenge}, $expiresAt, FALSE)
                   """.asUpdate)
    } yield ()

  /** Marks the code as used and returns what it was issued for, in one statement, so that a code can only ever be
    * redeemed once, even by concurrent requests. Empty if it is unknown, expired or used already.
    */
  def redeem(codeHash: String): Fox[OAuthAuthorizationCode] =
    for {
      rows <- run(q"""UPDATE webknossos.oauthAuthorizationCodes SET isUsed = TRUE
                      WHERE codeHash = $codeHash AND NOT isUsed AND expirationDateTime > NOW()
                      RETURNING _grant, redirectUri, codeChallenge""".as[(String, String, String)])
      row <- rows.headOption.toFox
    } yield OAuthAuthorizationCode(ObjectId(row._1), row._2, row._3)

  // The grant of a code that was redeemed before. Presenting such a code again means it leaked.
  def findGrantOfUsedCode(codeHash: String): Fox[ObjectId] =
    for {
      rows <- run(q"""SELECT _grant FROM webknossos.oauthAuthorizationCodes
                      WHERE codeHash = $codeHash AND isUsed""".as[String])
      grantId <- rows.headOption.toFox
    } yield ObjectId(grantId)

  def deleteAllByGrant(grantId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.oauthAuthorizationCodes WHERE _grant = $grantId".asUpdate)
    } yield ()

  def deleteAllExpired(): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.oauthAuthorizationCodes WHERE expirationDateTime <= NOW()".asUpdate)
    } yield ()
}

object OAuthTokenType extends ExtendedEnumeration {
  type OAuthTokenType = Value
  val Access, Refresh = Value
}

/** Access and refresh tokens issued to MCP clients. Only their hashes are stored. */
class OAuthTokenDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def insertOne(
      tokenHash: String,
      grantId: ObjectId,
      tokenType: OAuthTokenType.Value,
      expiresAt: Instant
  ): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.oauthTokens(tokenHash, _grant, tokenType, expirationDateTime, isUsed)
                   VALUES($tokenHash, $grantId, $tokenType, $expiresAt, FALSE)""".asUpdate)
    } yield ()

  // The grant of a valid access token. Revoked grants have their tokens deleted, so they are not found either.
  def findGrantOfAccessToken(tokenHash: String): Fox[ObjectId] =
    for {
      rows <- run(q"""SELECT _grant FROM webknossos.oauthTokens
                      WHERE tokenHash = $tokenHash
                      AND tokenType = ${OAuthTokenType.Access}
                      AND expirationDateTime > NOW()""".as[String])
      grantId <- rows.headOption.toFox
    } yield ObjectId(grantId)

  /** Marks a refresh token as used and returns its grant, in one statement, so that it can only be used once (refresh
    * token rotation). Empty if it is unknown, expired or used already.
    */
  def redeemRefreshToken(tokenHash: String): Fox[ObjectId] =
    for {
      rows <- run(q"""UPDATE webknossos.oauthTokens SET isUsed = TRUE
                      WHERE tokenHash = $tokenHash
                      AND tokenType = ${OAuthTokenType.Refresh}
                      AND NOT isUsed
                      AND expirationDateTime > NOW()
                      RETURNING _grant""".as[String])
      grantId <- rows.headOption.toFox
    } yield ObjectId(grantId)

  // The grant of a refresh token that was used before. Presenting such a token again means it leaked.
  def findGrantOfUsedRefreshToken(tokenHash: String): Fox[ObjectId] =
    for {
      rows <- run(q"""SELECT _grant FROM webknossos.oauthTokens
                      WHERE tokenHash = $tokenHash AND tokenType = ${OAuthTokenType.Refresh} AND isUsed""".as[String])
      grantId <- rows.headOption.toFox
    } yield ObjectId(grantId)

  def deleteAllByGrant(grantId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.oauthTokens WHERE _grant = $grantId".asUpdate)
    } yield ()

  /* Used refresh tokens are kept until they expire, so that their reuse is still recognized. */
  def deleteAllExpired(): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.oauthTokens WHERE expirationDateTime <= NOW()".asUpdate)
    } yield ()
}

/** Clients that registered themselves via Dynamic Client Registration (RFC 7591). */
class OAuthClientDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def insertOne(client: OAuthClientMetadata): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.oauthClients(clientId, clientName, redirectUris)
                   VALUES(${client.clientId}, ${client.clientName}, ${client.redirectUris})""".asUpdate)
    } yield ()

  def findOne(clientId: String): Fox[OAuthClientMetadata] =
    for {
      rows <- run(q"""SELECT clientId, clientName, redirectUris FROM webknossos.oauthClients
                      WHERE clientId = $clientId""".as[(String, String, String)])
      row <- rows.headOption.toFox
    } yield OAuthClientMetadata(row._1, row._2, parseArrayLiteral(row._3), isRegistered = true)

  // Anyone can register a client, so registrations that did not lead to a connection are not kept.
  def deleteUnusedCreatedBefore(cutoff: Instant): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.oauthClients c
                   WHERE c.created < $cutoff
                   AND NOT EXISTS (SELECT 1 FROM webknossos.oauthGrants g WHERE g.clientId = c.clientId)""".asUpdate)
    } yield ()
}
