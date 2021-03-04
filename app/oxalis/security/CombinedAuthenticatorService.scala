package oxalis.security

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.crypto.{Base64AuthenticatorEncoder, Signer}
import com.mohiva.play.silhouette.api.services.{AuthenticatorResult, AuthenticatorService}
import com.mohiva.play.silhouette.api.util.{Clock, ExtractableRequest, FingerprintGenerator, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators._
import models.user.UserService
import play.api.mvc._
import utils.WkConf

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Success, Try}

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

class IdentityCookieSigner extends Signer {
  override def sign(data: String): String = data
  override def extract(message: String): Try[String] = Success(message)
}

case class CombinedAuthenticatorService(cookieSettings: CookieAuthenticatorSettings,
                                        tokenSettings: BearerTokenAuthenticatorSettings,
                                        tokenDao: BearerTokenAuthenticatorRepository,
                                        fingerprintGenerator: FingerprintGenerator,
                                        cookieHeaderEncoding: CookieHeaderEncoding,
                                        idGenerator: IDGenerator,
                                        clock: Clock,
                                        userService: UserService,
                                        conf: WkConf)(implicit val executionContext: ExecutionContext)
    extends AuthenticatorService[CombinedAuthenticator]
    with Logger {

  val cookieAuthenticatorService = new CookieAuthenticatorService(cookieSettings,
                                                                  None,
                                                                  new IdentityCookieSigner,
                                                                  cookieHeaderEncoding,
                                                                  new Base64AuthenticatorEncoder,
                                                                  fingerprintGenerator,
                                                                  idGenerator,
                                                                  clock)

  val tokenAuthenticatorService =
    new WebknossosBearerTokenAuthenticatorService(tokenSettings, tokenDao, idGenerator, clock, userService, conf)

  //is actually createCookie, called as "create" because it is the default
  override def create(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[CombinedAuthenticator] =
    cookieAuthenticatorService.create(loginInfo).map(CombinedAuthenticator(_))

  def createToken(loginInfo: LoginInfo): Future[CombinedAuthenticator] = {
    val tokenAuthenticator = tokenAuthenticatorService.create(loginInfo, TokenType.Authentication)
    tokenAuthenticator.map(tokenAuthenticatorService.init(_, TokenType.Authentication))
    tokenAuthenticator.map(CombinedAuthenticator(_))
  }

  override def retrieve[B](implicit request: ExtractableRequest[B]): Future[Option[CombinedAuthenticator]] =
    for {
      optionCookie <- cookieAuthenticatorService.retrieve(request)
      optionToken <- tokenAuthenticatorService.retrieve(request)
    } yield {
      optionCookie.map(CombinedAuthenticator(_)).orElse { optionToken.map(CombinedAuthenticator(_)) }
    }

  // only called in token case
  def findByLoginInfo(loginInfo: LoginInfo): Future[Option[CombinedAuthenticator]] =
    tokenDao.findOneByLoginInfo(loginInfo, TokenType.Authentication).map(opt => opt.map(CombinedAuthenticator(_)))

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

  override def update(authenticator: CombinedAuthenticator, result: Result)(
      implicit request: RequestHeader): Future[AuthenticatorResult] = authenticator.actualAuthenticator match {
    case a: CookieAuthenticator      => cookieAuthenticatorService.update(a, result)
    case a: BearerTokenAuthenticator => tokenAuthenticatorService.update(a, result)
  }

  // only called in the cookie case
  override def renew(authenticator: CombinedAuthenticator)(implicit request: RequestHeader): Future[Cookie] =
    cookieAuthenticatorService.renew(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator])

  // only called in the cookie case
  override def renew(authenticator: CombinedAuthenticator, result: Result)(
      implicit request: RequestHeader): Future[AuthenticatorResult] =
    cookieAuthenticatorService.renew(authenticator.actualAuthenticator.asInstanceOf[CookieAuthenticator], result)

  override def discard(authenticator: CombinedAuthenticator, result: Result)(
      implicit request: RequestHeader): Future[AuthenticatorResult] =
    authenticator.actualAuthenticator match {
      case a: CookieAuthenticator      => cookieAuthenticatorService.discard(a, result)
      case a: BearerTokenAuthenticator => tokenAuthenticatorService.discard(a, result)
    }
}
