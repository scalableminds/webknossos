package oxalis.security

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.exceptions._
import com.mohiva.play.silhouette.api.services.{AuthenticatorResult, AuthenticatorService}
import com.mohiva.play.silhouette.api.util.{Base64, Clock, FingerprintGenerator, IDGenerator}
import com.mohiva.play.silhouette.impl.authenticators.CookieAuthenticatorService.{InvalidJsonFormat, JsonParseError}
import com.mohiva.play.silhouette.impl.authenticators._
import com.mohiva.play.silhouette.impl.util.CookieSigner
import play.api.libs.Crypto
import play.api.libs.json.Json
import com.mohiva.play.silhouette.impl.daos.AuthenticatorDAO
import org.joda.time.DateTime
import play.api.http.HeaderNames
import play.api.libs.Crypto
import play.api.libs.json.Json
import play.api.mvc._

import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration.FiniteDuration
import scala.util.{Failure, Success, Try}
import com.mohiva.play.silhouette._
import play.api.http.HeaderNames
import CombinedAuthenticatorService._
import scala.concurrent.duration._
import scala.concurrent.{ ExecutionContext, Future }
import play.api.libs.json._
import play.api.libs.json.Reads._
import play.api.libs.json.Writes._
/**
  * Created by robert on 10.11.17.
  *
  * The code is adjusted to fit with our own CombinedAuthenticator.
  * The original code is from silhouette.impl.authenticators.CookieAuthenticator
  */


/**
  *
  * @param typ                to specify whether to use Cookie or Token
  * @param id                 The authenticator ID.
  * @param loginInfoParameter The linked login info for an identity.
  * @param lastUsedDateTime   The last used date/time.
  * @param expirationDateTime The expiration date/time.
  * @param idleTimeout        The duration an authenticator can be idle before it timed out.
  * @param cookieMaxAge       [Only useful for Cookies, but not necessary] The duration a cookie expires. `None` for a transient cookie.
  * @param fingerprint        [Only useful for Cookies, but not necessary] Maybe a fingerprint of the user.
  */
case class CombinedAuthenticator(typ: String, //is there a way to force the typ to be "COOKIE" or "TOKEN" or is that not necessary?
                                 id: String,
                                 loginInfoParameter: LoginInfo,
                                 lastUsedDateTime: DateTime,
                                 expirationDateTime: DateTime,
                                 idleTimeout: Option[FiniteDuration],
                                 cookieMaxAge: Option[FiniteDuration],
                                 fingerprint: Option[String])
  extends StorableAuthenticator with ExpirableAuthenticator {
  override type Value = Cookie //maybe change this
  override type Settings = this.type

  override def loginInfo: LoginInfo = loginInfoParameter

  val cookieAuthenticator = CookieAuthenticator(id, loginInfo, lastUsedDateTime, expirationDateTime, idleTimeout, cookieMaxAge, fingerprint)
  val tokenAuthenticator = BearerTokenAuthenticator(id, loginInfo, lastUsedDateTime, expirationDateTime, idleTimeout)
}


case class CombinedAuthenticatorService(cookieSettings: CookieAuthenticatorSettings,
                                   tokenSettings: BearerTokenAuthenticatorSettings,
                                   //cookieDao: Option[AuthenticatorDAO[CookieAuthenticator]],
                                   //tokenDao : AuthenticatorDAO[BearerTokenAuthenticator],
                                   cookieDao: Option[CombinedAuthenticatorDAO],
                                   tokenDao : CombinedAuthenticatorDAO,
                                   fingerprintGenerator: FingerprintGenerator,
                                   idGenerator: IDGenerator,
                                   clock: Clock)(implicit val executionContext: ExecutionContext)
  extends AuthenticatorService[CombinedAuthenticator]
    with Logger {

  import CombinedAuthenticator._
  import AuthenticatorService._
  import CombinedAuthenticatorService._

  /**
    * Creates a new authenticator for the specified login info.
    *
    * @param loginInfo The login info for which the authenticator should be created.
    * @param request   The request header.
    * @return An authenticator.
    */
  override def create(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[CombinedAuthenticator] = {
    idGenerator.generate.map { id =>
      val now = clock.now
      CombinedAuthenticator(
        typ = "COOKIE",
        id = id,
        loginInfoParameter = loginInfo,
        lastUsedDateTime = now,
        expirationDateTime = now.plusSeconds(cookieSettings.authenticatorExpiry.toSeconds.toInt),
        idleTimeout = cookieSettings.authenticatorIdleTimeout,
        cookieMaxAge = cookieSettings.cookieMaxAge,
        fingerprint = if (cookieSettings.useFingerprinting) Some(fingerprintGenerator.generate) else None
      )
    }.recover {
      case e => throw new AuthenticatorCreationException(CreateError.format(ID, loginInfo), e)
    }
  }

  /**
    * Creates a new authenticator for the specified login info and adds it to the DAO.
    *
    * @param loginInfo The login info for which the authenticator should be created.
    * @param request   The request header.
    * @return An authenticator.
    */
  def createToken(loginInfo: LoginInfo)(implicit request: RequestHeader): Future[CombinedAuthenticator] = {
    idGenerator.generate.flatMap { id =>
      val now = clock.now
      val authenticator = CombinedAuthenticator(
        typ = "TOKEN",
        id = id,
        loginInfoParameter = loginInfo,
        lastUsedDateTime = now,
        expirationDateTime = now.plusSeconds(cookieSettings.authenticatorExpiry.toSeconds.toInt),
        idleTimeout = cookieSettings.authenticatorIdleTimeout,
        cookieMaxAge = cookieSettings.cookieMaxAge,
        fingerprint = if (cookieSettings.useFingerprinting) Some(fingerprintGenerator.generate) else None
      )
      tokenDao.add(authenticator).map { a =>
        a
      }.recover {
        case e => throw new AuthenticatorInitializationException(InitError.format(ID, authenticator), e)
      }
    }.recover {
      case e => throw new AuthenticatorCreationException(CreateError.format(ID, loginInfo), e)
    }
  }
  /**
    * Retrieves the authenticator from request.
    *
    * @param request The request header.
    * @return Some authenticator or None if no authenticator could be found in request.
    */
  override def retrieve(implicit request: RequestHeader): Future[Option[CombinedAuthenticator]] = {
    for{
      optionCookie <- retrieveCookie
      optionToken <- retrieveToken
    }yield{
      if(optionCookie.isDefined) optionCookie else optionToken
    }
  }

  def retrieveCookie(implicit request: RequestHeader): Future[Option[CombinedAuthenticator]] = {
    Future.from(Try {
      if (cookieSettings.useFingerprinting) Some(fingerprintGenerator.generate) else None
    }).flatMap { fingerprint =>
      request.cookies.get(cookieSettings.cookieName) match {
        case Some(cookie) =>
          (cookieDao match {
            case Some(d) => d.find(cookie.value)
            case None => CombinedAuthenticator.unserialize(cookie.value) match {
              case Success(authenticator) => Future.successful(Some(authenticator))
              case Failure(error) =>
                logger.info(error.getMessage, error)
                Future.successful(None)
            }
          }).map {
            case Some(a) if fingerprint.isDefined && a.fingerprint != fingerprint =>
              logger.info(InvalidFingerprint.format(ID, fingerprint, a))
              None
            case v => v
          }
        case None => Future.successful(None)
      }
    }.recover {
      case e => throw new AuthenticatorRetrievalException(RetrieveError.format(ID), e)
    }
  }

  def retrieveToken(implicit request: RequestHeader): Future[Option[CombinedAuthenticator]] = {
    Future.from(Try(request.headers.get(tokenSettings.headerName))).flatMap {
      case Some(token) => tokenDao.find(token)
      case None => Future.successful(None)
    }.recover {
      case e => throw new AuthenticatorRetrievalException(RetrieveError.format(ID), e)
    }
  }

  /**
    * Creates a new cookie for the given authenticator and return it.
    *
    * If the stateful approach will be used the the authenticator will also be
    * stored in the backing store.
    *
    * @param authenticator The authenticator instance.
    * @param request       The request header.
    * @return The serialized authenticator value.
    */
  override def init(authenticator: CombinedAuthenticator)(implicit request: RequestHeader): Future[Cookie] = {
    (cookieDao match {
      case Some(d) => d.add(authenticator).map(_.id)
      case None => Future.successful(serialize(authenticator))
    }).map { value =>
      Cookie(
        name = cookieSettings.cookieName,
        value = value,
        // The maxAge` must be used from the authenticator, because it might be changed by the user
        // to implement "Remember Me" functionality
        maxAge = authenticator.cookieMaxAge.map(_.toSeconds.toInt),
        path = cookieSettings.cookiePath,
        domain = cookieSettings.cookieDomain,
        secure = cookieSettings.secureCookie,
        httpOnly = cookieSettings.httpOnlyCookie
      )
    }.recover {
      case e => throw new AuthenticatorInitializationException(InitError.format(ID, authenticator), e)
    }
  }

  /**
    * Embeds the cookie into the result.
    *
    * @param cookie  The cookie to embed.
    * @param result  The result to manipulate.
    * @param request The request header.
    * @return The manipulated result.
    */
  override def embed(cookie: Cookie, result: Result)(implicit request: RequestHeader): Future[AuthenticatorResult] = {
    Future.successful(AuthenticatorResult(result.withCookies(cookie)))
  }

  /**
    * Embeds the cookie into the request.
    *
    * @param cookie  The cookie to embed.
    * @param request The request header.
    * @return The manipulated request header.
    */
  override def embed(cookie: Cookie, request: RequestHeader): RequestHeader = {
    val cookies = Cookies.mergeCookieHeader(request.headers.get(HeaderNames.COOKIE).getOrElse(""), Seq(cookie))
    val additional = Seq(HeaderNames.COOKIE -> cookies)
    request.copy(headers = request.headers.replace(additional: _*))
  }

  /**
    * @inheritdoc
    * @param authenticator The authenticator to touch.
    * @return The touched authenticator on the left or the untouched authenticator on the right.
    */
  override def touch(authenticator: CombinedAuthenticator): Either[CombinedAuthenticator, CombinedAuthenticator] = {
    if (authenticator.idleTimeout.isDefined) {
      Left(authenticator.copy(lastUsedDateTime = clock.now))
    } else {
      Right(authenticator)
    }
  }

  /**
    * Updates the authenticator with the new last used date.
    *
    * If the stateless approach will be used then we update the cookie on the client. With the stateful approach
    * we needn't embed the cookie in the response here because the cookie itself will not be changed. Only the
    * authenticator in the backing store will be changed.
    *
    * @param authenticator The authenticator to update.
    * @param result        The result to manipulate.
    * @param request       The request header.
    * @return The original or a manipulated result.
    */
  override def update(authenticator: CombinedAuthenticator, result: Result)(
    implicit request: RequestHeader): Future[AuthenticatorResult] = {

    (cookieDao match {
      case Some(d) => d.update(authenticator).map(_ => AuthenticatorResult(result))
      case None => Future.successful(AuthenticatorResult(result.withCookies(Cookie(
        name = cookieSettings.cookieName,
        value = serialize(authenticator),
        // The maxAge` must be used from the authenticator, because it might be changed by the user
        // to implement "Remember Me" functionality
        maxAge = authenticator.cookieMaxAge.map(_.toSeconds.toInt),
        path = cookieSettings.cookiePath,
        domain = cookieSettings.cookieDomain,
        secure = cookieSettings.secureCookie,
        httpOnly = cookieSettings.httpOnlyCookie
      ))))
    }).recover {
      case e => throw new AuthenticatorUpdateException(UpdateError.format(ID, authenticator), e)
    }
  }

  /**
    * Renews an authenticator.
    *
    * After that it isn't possible to use a cookie which was bound to this authenticator. This method
    * doesn't embed the the authenticator into the result. This must be done manually if needed
    * or use the other renew method otherwise.
    *
    * @param authenticator The authenticator to renew.
    * @param request       The request header.
    * @return The serialized expression of the authenticator.
    */
  override def renew(authenticator: CombinedAuthenticator)(implicit request: RequestHeader): Future[Cookie] = {
    (cookieDao match {
      case Some(d) => d.remove(authenticator.id)
      case None => Future.successful(())
    }).flatMap { _ =>
      create(authenticator.loginInfo).flatMap(init)
    }.recover {
      case e => throw new AuthenticatorRenewalException(RenewError.format(ID, authenticator), e)
    }
  }

  /**
    * Renews an authenticator and replaces the authenticator cookie with a new one.
    *
    * If the stateful approach will be used then the old authenticator will be revoked in the backing
    * store. After that it isn't possible to use a cookie which was bound to this authenticator.
    *
    * @param authenticator The authenticator to update.
    * @param result        The result to manipulate.
    * @param request       The request header.
    * @return The original or a manipulated result.
    */
  override def renew(authenticator: CombinedAuthenticator, result: Result)(
    implicit request: RequestHeader): Future[AuthenticatorResult] = {

    renew(authenticator).flatMap(v => embed(v, result)).recover {
      case e => throw new AuthenticatorRenewalException(RenewError.format(ID, authenticator), e)
    }
  }

  /**
    * Discards the cookie.
    *
    * If the stateful approach will be used then the authenticator will also be removed from backing store.
    *
    * @param result  The result to manipulate.
    * @param request The request header.
    * @return The manipulated result.
    */
  override def discard(authenticator: CombinedAuthenticator, result: Result)(
    implicit request: RequestHeader): Future[AuthenticatorResult] = {

    (cookieDao match {
      case Some(d) => d.remove(authenticator.id)
      case None => Future.successful(())
    }).map { _ =>
      AuthenticatorResult(result.discardingCookies(DiscardingCookie(
        name = cookieSettings.cookieName,
        path = cookieSettings.cookiePath,
        domain = cookieSettings.cookieDomain,
        secure = cookieSettings.secureCookie)))
    }.recover {
      case e => throw new AuthenticatorDiscardingException(DiscardError.format(ID, authenticator), e)
    }
  }

  def discardToken(authenticator: BearerTokenAuthenticator, result: Result)(
    implicit request: RequestHeader): Future[AuthenticatorResult] = {

    tokenDao.remove(authenticator.id).map { _ =>
      AuthenticatorResult(result)
    }.recover {
      case e => throw new AuthenticatorDiscardingException(DiscardError.format(ID, authenticator), e)
    }
  }
}


object CombinedAuthenticator {
  val CookieTyp = "COOKIE"
  val TokenTyp = "TOKEN"

  val WrongTypError = "The Typ of the Authenticator is wrong. Use " + CookieTyp + " or " + TokenTyp + " for this." //maybe put this in Messages

  implicit object FiniteDurationFormat extends Format[FiniteDuration] {
    def reads(json: JsValue): JsResult[FiniteDuration] = LongReads.reads(json).map(_.seconds)
    def writes(o: FiniteDuration): JsValue = LongWrites.writes(o.toSeconds)
  }

  implicit def optionFormat[T: Format]: Format[Option[T]] = new Format[Option[T]]{
    override def reads(json: JsValue): JsResult[Option[T]] = json.validateOpt[T]

    override def writes(o: Option[T]): JsValue = o match {
      case Some(t) ⇒ implicitly[Writes[T]].writes(t)
      case None ⇒ JsNull
    }
  }

  /**
    * Converts the CookieAuthenticator to Json and vice versa.
    */
  implicit val jsonFormat = Json.format[CombinedAuthenticator]

  /**
    * Serializes the authenticator.
    *
    * @param authenticator The authenticator to serialize.
    * @return The serialized authenticator.
    */
  def serialize(authenticator: CombinedAuthenticator): String = {
    SignedCookieSerializationStrategy.serialize(authenticator)
  }

  /**
    * Unserializes the authenticator.
    *
    * @param str The string representation of the authenticator.
    * @return Some authenticator on success, otherwise None.
    */
  def unserialize(str: String): Try[CombinedAuthenticator] = {
    SignedCookieSerializationStrategy.unserialize(str)
  }

  /**
    * Builds the authenticator from Json.
    *
    * @param str The string representation of the authenticator.
    * @return Some authenticator on success, otherwise None.
    */
  private[security] def buildAuthenticator(str: String): Try[CombinedAuthenticator] = {
    Try(Json.parse(str)) match {
      case Success(json) => json.validate[CombinedAuthenticator].asEither match {
        case Left(error) => Failure(new AuthenticatorException(InvalidJsonFormat.format(ID, error)))
        case Right(authenticator) => Success(authenticator)
      }
      case Failure(error) => Failure(new AuthenticatorException(JsonParseError.format(ID, str), error))
    }
  }
}

object SignedCookieSerializationStrategy{
  import CombinedAuthenticator.buildAuthenticator

  /**
    * The cookie signer instance.
    */
  private val pepper: String = "-mohiva-silhouette-cookie-authenticator-"
  private val cookieSigner = new CookieSigner(None, pepper)

  def encode(data: String): String = Crypto.encryptAES(data)
  def decode(data: String): String = Crypto.decryptAES(data)

  /**
    * Unserializes an authenticator.
    *
    * @param str The serialized cookie value.
    * @return Authenticator wrapped in Success in case of success, or corresponding Failure in case of wrong supplied data.
    */
  def unserialize(str: String): Try[CombinedAuthenticator] = {
    cookieSigner.extract(str).map { data =>
      buildAuthenticator(decode(data))
    }.flatten
  }

  /**
    * Serializes an authenticator.
    *
    * @param authenticator The authenticator to serialize.
    * @return The serialized authenticator.
    */
  def serialize(authenticator: CombinedAuthenticator): String = {
    val data = encode(Json.toJson(authenticator).toString())
    cookieSigner.sign(data)
  }
}

object CombinedAuthenticatorService{

  val ID = "cookie-authenticator"

  /**
    * The error messages.
    */

  val JsonParseError = "[Silhouette][%s] Cannot parse Json: %s"
  val InvalidJsonFormat = "[Silhouette][%s] Invalid Json format: %s"
  val InvalidFingerprint = "[Silhouette][%s] Fingerprint %s doesn't match authenticator: %s"
}
