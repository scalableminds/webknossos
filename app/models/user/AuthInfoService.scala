package models.user

import com.mohiva.play.silhouette.api.{AuthInfo, LoginInfo}
import com.mohiva.play.silhouette.api.repositories.AuthInfoRepository

import scala.concurrent.Future
import scala.reflect.ClassTag

object AuthInfoService extends AuthInfoRepository{
  override def find[T <: AuthInfo](loginInfo: LoginInfo)(implicit tag: ClassTag[T]): Future[Option[T]] =
    UserService.findOneByEmail(loginInfo.providerKey).futureBox.map(_.toOption)

  override def add[T <: AuthInfo](loginInfo: LoginInfo, authInfo: T): Future[T] = ???

  override def update[T <: AuthInfo](loginInfo: LoginInfo, authInfo: T): Future[T] = ???

  override def save[T <: AuthInfo](loginInfo: LoginInfo, authInfo: T): Future[T] = ???

  override def remove[T <: AuthInfo](loginInfo: LoginInfo)(implicit tag: ClassTag[T]): Future[Unit] = ???
}
