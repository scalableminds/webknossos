package oxalis.security

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.services.{AuthenticatorResult, AuthenticatorService}
import com.mohiva.play.silhouette.api.util.{Clock, FingerprintGenerator, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators._
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}

/*
 * Combining BearerTokenAuthenticator and TokenAuthenticator from Silhouette
 */

case class CombinedAuthenticator(actualAuthenticator: StorableAuthenticator) extends StorableAuthenticator {
  def id = actualAuthenticator.id
  override type Value = Cookie
  override type Settings = this.type

  override def loginInfo = actualAuthenticator.loginInfo
  override def isValid: Boolean = actualAuthenticator.isValid
}

case class CombinedAuthenticatorService(cookieSettings: CookieAuthenticatorSettings,
                                        tokenSettings: BearerTokenAuthenticatorSettings,
                                        tokenDao : BearerTokenAuthenticatorDAO,
                                        fingerprintGenerator: FingerprintGenerator,
                                        idGenerator: IDGenerator,
                                        clock: Clock)(implicit val executionContext: ExecutionContext)
  extends AuthenticatorService[CombinedAuthenticator] with Logger {

  val cookieAuthenticatorService = new CookieAuthenticatorService(cookieSettings, None, fingerprintGenerator, idGenerator, clock)
  val tokenAuthenticatorService = new BearerTokenAuthenticatorService(tokenSettings, tokenDao, idGenerator, clock)

  //is actually createCookie, called as "create" because it is the default
  override def create(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[CombinedAuthenticator] = {
    val cookieAuthenticator: Future[CookieAuthenticator] = cookieAuthenticatorService.create(loginInfo)
    cookieAuthenticator.map(CombinedAuthenticator(_))
  }

  def createToken(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[CombinedAuthenticator] = {
    val cookieAuthenticator: Future[CookieAuthenticator] = cookieAuthenticatorService.create(loginInfo)
    cookieAuthenticator.map(CombinedAuthenticator(_))
  }

  override def retrieve(implicit request: RequestHeader): Future[Option[CombinedAuthenticator]] = {
    for {
      optionCookie <- cookieAuthenticatorService.retrieve(request)
      optionToken <- tokenAuthenticatorService.retrieve(request)
    } yield {
      optionCookie.map(CombinedAuthenticator(_)).orElse{optionToken.map(CombinedAuthenticator(_))}
    }
  }

  // only called in token case
  def findByLoginInfo(loginInfo: LoginInfo) =
    tokenDao.findByLoginInfo(loginInfo).map(opt => opt.map(CombinedAuthenticator(_)))

  // only called in the cookie case
  override def init(authenticator: CombinedAuthenticator)(implicit request: RequestHeader): Future[Cookie] =
    cookieAuthenticatorService.init(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator])

  // only called in the cookie case
  override def embed(cookie: Cookie, result: Result)(implicit request: RequestHeader): Future[AuthenticatorResult] =
    cookieAuthenticatorService.embed(cookie, result)

  // only called in the cookie case
  override def embed(cookie: Cookie, request: RequestHeader): RequestHeader =
    cookieAuthenticatorService.embed(cookie, request)

  // only called in the cookie case
  override def touch(authenticator: CombinedAuthenticator): Either[CombinedAuthenticator, CombinedAuthenticator] = {
    val touchedAuthenticator = cookieAuthenticatorService.touch(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator])
    touchedAuthenticator match {
      case Left(c) => Left(CombinedAuthenticator(c))
      case Right(c) => Right(CombinedAuthenticator(c))
    }
  }

  // only called in the cookie case
  override def update(authenticator: CombinedAuthenticator, result: Result)
                     (implicit request: RequestHeader): Future[AuthenticatorResult] =
    cookieAuthenticatorService.update(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator], result)

  // only called in the cookie case
  override def renew(authenticator: CombinedAuthenticator)(implicit request: RequestHeader): Future[Cookie] =
    cookieAuthenticatorService.renew(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator])

  // only called in the cookie case
  override def renew(authenticator: CombinedAuthenticator, result: Result)(implicit request: RequestHeader): Future[AuthenticatorResult] =
    cookieAuthenticatorService.renew(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator], result)

  //is actually discardCookie, called as "discard" because it is the default
  override def discard(authenticator: CombinedAuthenticator, result: Result)(implicit request: RequestHeader): Future[AuthenticatorResult] =
    cookieAuthenticatorService.discard(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator], result)

  def discardToken(authenticator: CombinedAuthenticator, result: Result)(implicit request: RequestHeader): Future[AuthenticatorResult] =
    tokenAuthenticatorService.discard(authenticator.actualAuthenticator.asInstanceOf[BearerTokenAuthenticator], result)
}

