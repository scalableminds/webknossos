package models.user

import akka.actor.ActorSystem
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import oxalis.mail.{DefaultMails, Send}
import oxalis.security.RandomIDGenerator
import utils.{ObjectId, WkConf}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class EmailVerificationService @Inject()(conf: WkConf,
                                         emailVerificationKeyDAO: EmailVerificationKeyDAO,
                                         multiUserDAO: MultiUserDAO,
                                         defaultMails: DefaultMails,
                                         actorSystem: ActorSystem) {

  private lazy val Mailer =
    actorSystem.actorSelection("/user/mailActor")

  def sendEmailVerification(multiUser: MultiUser)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      key: String <- Fox.successful(RandomIDGenerator.generateBlocking(32))
      expiration = Instant.now + conf.WebKnossos.User.EmailVerification.linkExpiry
      evk: EmailVerificationKey = EmailVerificationKey(ObjectId.generate,
                                                       key,
                                                       multiUser.email,
                                                       multiUser._id,
                                                       expiration)
      _ <- emailVerificationKeyDAO.insertOne(evk)
      _ = Mailer ! Send(defaultMails.emailVerificationMail(multiUser.email, key))
    } yield ()

  def verify(key: String)(implicit ctx: DBAccessContext, ec: ExecutionContext): Fox[Unit] =
    for {
      evk <- emailVerificationKeyDAO.findOneByKey(key)
      multiUser <- multiUserDAO.findOne(evk._multiUser)
      _ <- Fox.bool2Fox(evk.email == multiUser.email)
      _ = multiUserDAO.updateEmailVerification(evk._multiUser, verified = true) //TODO: Mark key as used
    } yield ()

  def assertUserHasVerifiedEmail(user: User)(
      implicit ctx: DBAccessContext,
      ec: ExecutionContext
  ): Fox[Unit] =
    for {
      multiUser: MultiUser <- multiUserDAO.findOne(user._multiUser)
      endOfGracePeriod: Instant = multiUser.created + conf.WebKnossos.User.EmailVerification.gracePeriod
      overGracePeriod = endOfGracePeriod.isPast
      _ <- Fox.bool2Fox(
        !conf.WebKnossos.User.EmailVerification.required || multiUser.isEmailVerified || !overGracePeriod) ?~> "user.email.notVerified"
    } yield ()
}
