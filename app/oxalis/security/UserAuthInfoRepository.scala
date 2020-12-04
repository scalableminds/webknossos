package oxalis.security

import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository
import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.api.{AuthInfo, LoginInfo}
import models.user.UserService

import javax.inject.Inject
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.reflect.ClassTag

class UserAuthInfoRepository @Inject()(userService: UserService) extends AuthInfoRepository {

  override def find[T <: AuthInfo](loginInfo: LoginInfo)(implicit tag: ClassTag[T]): Future[Option[T]] =
    for {
      userOpt <- userService.retrieve(loginInfo)
    } yield userOpt.map(_.passwordInfo.asInstanceOf[T])

  override def update[T <: AuthInfo](loginInfo: LoginInfo, authInfo: T): Future[T] =
    userService
      .changePasswordInfo(loginInfo, authInfo.asInstanceOf[PasswordInfo])
      .toFutureWithEmptyToFailure
      .map(_.asInstanceOf[T])

  override def add[T <: AuthInfo](loginInfo: LoginInfo, authInfo: T): Future[T] =
    Future.failed(new Exception("Not Implemented"))

  override def save[T <: AuthInfo](loginInfo: LoginInfo, authInfo: T): Future[T] =
    Future.failed(new Exception("Not Implemented"))

  override def remove[T <: AuthInfo](loginInfo: LoginInfo)(implicit tag: ClassTag[T]): Future[Unit] =
    Future.failed(new Exception("Not Implemented"))
}
