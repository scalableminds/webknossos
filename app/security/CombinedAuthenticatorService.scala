package security

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import play.silhouette.api.*
import play.silhouette.api.crypto.Base64AuthenticatorEncoder
import play.silhouette.api.services.{AuthenticatorResult, AuthenticatorService}
import play.silhouette.api.util.{Clock, ExtractableRequest, FingerprintGenerator, IDGenerator}
import play.silhouette.crypto.{JcaSigner, JcaSignerSettings}
import play.silhouette.impl.authenticators.{CookieAuthenticator, *}
import models.user.UserService
import play.api.http.HeaderNames
import play.api.mvc.*
import utils.WkConf

import scala.concurrent.{ExecutionContext, Future}

/*
 * Combining BearerTokenAuthenticator and TokenAuthenticator from Silhouette
 */

case class CombinedAuthenticator(actualAuthenticator: StorableAuthenticator) extends StorableAuthenticator {
  def id: String = actualAuthenticator.id
  override type Value = Cookie
  override type Settings = this.type

  override def loginInfo: LoginInfo = actualAuthenticator.loginInfo
  override def isValid: Boolean = actualAuthenticator.isValid
}

case class CombinedAuthenticatorService(
    cookieSettings: CookieAuthenticatorSettings,
    tokenSettings: BearerTokenAuthenticatorSettings,
    tokenDao: BearerTokenAuthenticatorRepository,
    fingerprintGenerator: FingerprintGenerator,
    cookieHeaderEncoding: CookieHeaderEncoding,
    idGenerator: IDGenerator,
    clock: Clock,
    userService: UserService,
    shortLivedTokenService: ShortLivedTokenService,
    conf: WkConf
)(implicit val executionContext: ExecutionContext)
    extends AuthenticatorService[CombinedAuthenticator]
    with Logger {

  private val bearerPrefix = "Bearer "

  private val cookieSigner = new JcaSigner(JcaSignerSettings(conf.Silhouette.CookieAuthenticator.signerSecret))

  private val cookieAuthenticatorService = new CookieAuthenticatorService(
    cookieSettings,
    None,
    cookieSigner,
    cookieHeaderEncoding,
    new Base64AuthenticatorEncoder,
    fingerprintGenerator,
    idGenerator,
    clock
  )

  val tokenAuthenticatorService =
    new WebknossosBearerTokenAuthenticatorService(
      tokenSettings,
      tokenDao,
      idGenerator,
      clock,
      userService,
      shortLivedTokenService,
      conf
    )

  // is actually createCookie, called as "create" because it is the default
  override def create(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[CombinedAuthenticator] =
    cookieAuthenticatorService.create(loginInfo).map(CombinedAuthenticator(_))

  private def createToken(userId: ObjectId): Future[CombinedAuthenticator] =
    for {
      tokenAuthenticator <- tokenAuthenticatorService.create(userId, TokenType.Authentication)
      _ <- tokenAuthenticatorService.init(tokenAuthenticator, TokenType.Authentication, deleteOld = true)
    } yield CombinedAuthenticator(tokenAuthenticator)

  def findOrCreateTokenForUser(userId: ObjectId): Future[CombinedAuthenticator] =
    findTokenForUser(userId).flatMap {
      case Some(token) => Future.successful(token)
      case _           =>
        createToken(userId)
    }

  override def retrieve[B](implicit request: ExtractableRequest[B]): Future[Option[CombinedAuthenticator]] =
    for {
      optionCookie <- cookieAuthenticatorService.retrieve(using request)
      optionCookieUnlessSignedOutEverywhere <- cookieUnlessSignedOutEverywhere(optionCookie)
      // Silhouette only reads the X-Auth-Token header. Authorization: Bearer is handled separately below.
      optionToken <- tokenAuthenticatorService.retrieve(using request)
      optionTokenOrBearer <- optionToken match {
        case Some(_) => Future.successful(optionToken)
        case None    => retrieveByAuthorizationHeader(request)
      }
    } yield optionCookieUnlessSignedOutEverywhere
      .map(CombinedAuthenticator(_))
      .orElse(optionTokenOrBearer.map(CombinedAuthenticator(_)))
      .orElse(retrieveShortLived(request).map(CombinedAuthenticator(_)))

  private def retrieveByAuthorizationHeader(request: RequestHeader): Future[Option[BearerTokenAuthenticator]] =
    bearerAuthorizationHeaderValue(request) match {
      case None        => Future.successful(None)
      case Some(value) => tokenDao.findOneByValue(value).toFutureOption
    }

  /*
   * Short-lived tokens are held in memory only (see ShortLivedTokenService), so they are not found by the
   * silhouette token retrieval, which looks them up in the database. They are synthesized into a
   * BearerTokenAuthenticator here so that they authenticate all API routes just like a regular token.
   * Note that idleTimeout must stay None: silhouette only calls AuthenticatorService.update (which would
   * try to write to the database) for authenticators that define an idle timeout.
   */
  private def retrieveShortLived(request: RequestHeader): Option[BearerTokenAuthenticator] =
    tokenValueFromRequest(request).flatMap(shortLivedTokenService.findValid).map { shortLivedToken =>
      BearerTokenAuthenticator(
        id = shortLivedToken.value,
        loginInfo = LoginInfoAdapter.loginInfoFromUserId(shortLivedToken.userId),
        lastUsedDateTime = clock.now,
        expirationDateTime = shortLivedToken.expiresAt.toZonedDateTime,
        idleTimeout = None
      )
    }

  private def tokenValueFromRequest(request: RequestHeader): Option[String] =
    request.headers.get(tokenSettings.fieldName).orElse(bearerAuthorizationHeaderValue(request))

  private def bearerAuthorizationHeaderValue(request: RequestHeader): Option[String] =
    request.headers.get(HeaderNames.AUTHORIZATION).map(_.trim).collect {
      case header if header.toLowerCase.startsWith(bearerPrefix.toLowerCase) =>
        header.drop(bearerPrefix.length).trim
    }

  private def cookieUnlessSignedOutEverywhere(
      optionCookie: Option[CookieAuthenticator]
  ): Future[Option[CookieAuthenticator]] =
    optionCookie match {
      case None         => Future.successful(None)
      case Some(cookie) =>
        for {
          userOpt <- userService.retrieve(cookie.loginInfo)
          loggedOutEverywhereTime = userOpt.flatMap(_.loggedOutEverywhereTime).getOrElse(Instant.zero)
          cookieLastUsedTime = Instant(cookie.lastUsedDateTime.toInstant.toEpochMilli)
        } yield if (cookieLastUsedTime > loggedOutEverywhereTime) Some(cookie) else None
    }

  // only called in token case
  def findTokenForUser(userId: ObjectId): Future[Option[CombinedAuthenticator]] =
    tokenDao.findOneForUserAndType(userId, TokenType.Authentication).map(opt => opt.map(CombinedAuthenticator(_)))

  // only called in the cookie case
  override def init(authenticator: CombinedAuthenticator)(implicit request: RequestHeader): Future[Cookie] =
    cookieAuthenticatorService.init(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator])

  // only called in the cookie case
  override def embed(cookie: Cookie, result: Result)(implicit request: RequestHeader): Future[AuthenticatorResult] =
    cookieAuthenticatorService.embed(cookie, result)

  // only called in the cookie case
  override def embed(cookie: Cookie, request: RequestHeader): RequestHeader =
    cookieAuthenticatorService.embed(cookie, request)

  override def touch(authenticator: CombinedAuthenticator): Either[CombinedAuthenticator, CombinedAuthenticator] = {
    val touchedAuthenticator = authenticator.actualAuthenticator match {
      case a: CookieAuthenticator      => cookieAuthenticatorService.touch(a)
      case a: BearerTokenAuthenticator => tokenAuthenticatorService.touch(a)
    }
    touchedAuthenticator match {
      case Left(c)  => Left(CombinedAuthenticator(c))
      case Right(c) => Right(CombinedAuthenticator(c))
    }
  }

  override def update(authenticator: CombinedAuthenticator, result: Result)(implicit
      request: RequestHeader
  ): Future[AuthenticatorResult] = authenticator.actualAuthenticator match {
    case a: CookieAuthenticator      => cookieAuthenticatorService.update(a, result)
    case a: BearerTokenAuthenticator => tokenAuthenticatorService.update(a, result)
  }

  // only called in the cookie case
  override def renew(authenticator: CombinedAuthenticator)(implicit request: RequestHeader): Future[Cookie] =
    cookieAuthenticatorService.renew(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator])

  // only called in the cookie case
  override def renew(authenticator: CombinedAuthenticator, result: Result)(implicit
      request: RequestHeader
  ): Future[AuthenticatorResult] =
    cookieAuthenticatorService.renew(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator], result)

  override def discard(authenticator: CombinedAuthenticator, result: Result)(implicit
      request: RequestHeader
  ): Future[AuthenticatorResult] =
    authenticator.actualAuthenticator match {
      case a: CookieAuthenticator      => cookieAuthenticatorService.discard(a, result)
      case a: BearerTokenAuthenticator =>
        shortLivedTokenService.remove(a.id)
        tokenAuthenticatorService.discard(a, result)
    }
}
