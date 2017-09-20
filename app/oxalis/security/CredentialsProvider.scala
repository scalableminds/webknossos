package oxalis.security

import javax.inject.Inject

import com.mohiva.play.silhouette.api._
import com.mohiva.play.silhouette.api.exceptions.ConfigurationException
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.util.{Credentials, ExecutionContextProvider, PasswordInfo}
import com.mohiva.play.silhouette.impl.exceptions.{IdentityNotFoundException, InvalidPasswordException}
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider._
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.user.UserService
import net.liftweb.common.Full

import scala.concurrent.{ExecutionContext, Future}

/**
  * A provider for authenticating with credentials.
  *
  * The provider supports the change of password hashing algorithms on the fly. Sometimes it may be possible to change
  * the hashing algorithm used by the application. But the hashes stored in the backing store can't be converted back
  * into plain text passwords, to hash them again with the new algorithm. So if a user successfully authenticates after
  * the application has changed the hashing algorithm, the provider hashes the entered password again with the new
  * algorithm and stores the auth info in the backing store.
  *
  * @param passwordHasher The default password hasher used by the application.
  * //@param passwordHasherList List of password hasher supported by the application.
  * @param executionContext The execution context to handle the asynchronous operations.
  */
class CredentialsProvider @Inject() (passwordHasher: PasswordHasher)(implicit val executionContext: ExecutionContext)
  extends Provider with ExecutionContextProvider {

  override def id = ID

  //can be extended in the future with different hasher
  val passwordHasherList: List[PasswordHasher] = List(passwordHasher)

  def authenticate(credentials: Credentials): Future[LoginInfo] = {
    loginInfo(credentials).flatMap { loginInfo =>
      UserService.retrieve(loginInfo).flatMap {
        case Some(user) => passwordHasherList.find(_.id == user.passwordInfo.hasher) match {
          case Some(hasher) if hasher.matches(user.passwordInfo, credentials.password) =>
            if (hasher != passwordHasher) {
              UserService.changePasswordInfo(loginInfo, passwordHasher.hash(credentials.password)).map(_ => loginInfo).futureBox.map(
                _.openOrThrowException(throw new IdentityNotFoundException("User not found"))
              )
            } else {
              Future.successful(loginInfo)
            }
          case Some(hasher) => throw new InvalidPasswordException(InvalidPassword.format(id))
          case None => throw new ConfigurationException(UnsupportedHasher.format(
            id, user.passwordInfo.hasher, passwordHasherList.map(_.id).mkString(", ")
          ))
        }
        case None => throw new IdentityNotFoundException(UnknownCredentials.format(id))
      }
    }
  }

  def loginInfo(credentials: Credentials): Future[LoginInfo] = Future.successful(LoginInfo(id, credentials.identifier))
}

object CredentialsProvider {

  val UnknownCredentials = "[Silhouette][%s] Could not find auth info for given credentials"
  val InvalidPassword = "[Silhouette][%s] Passwords does not match"
  val UnsupportedHasher = "[Silhouette][%s] Stored hasher ID `%s` isn't contained in the list of supported hasher: %s"

  val ID = "credentials"
}
