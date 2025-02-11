package security

import play.silhouette.api.repositories.AuthInfoRepository
import play.silhouette.api.util.PasswordInfo
import play.silhouette.api.{AuthInfo, LoginInfo}
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.user.{MultiUserDAO, UserService}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}
import scala.reflect.ClassTag

class UserAuthInfoRepository @Inject() (userService: UserService, multiUserDAO: MultiUserDAO)(implicit
    ec: ExecutionContext
) extends AuthInfoRepository {

  override def find[T <: AuthInfo](loginInfo: LoginInfo)(implicit tag: ClassTag[T]): Future[Option[T]] =
    for {
      userOpt <- userService.retrieve(loginInfo)
      multiUserBox <- Fox
        .runOptional(userOpt)(user => multiUserDAO.findOne(user._multiUser)(GlobalAccessContext))
        .futureBox
    } yield multiUserBox.toOption.flatten.map(_.passwordInfo.asInstanceOf[T])

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
