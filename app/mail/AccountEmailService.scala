package mail

import com.scalableminds.util.tools.Fox
import models.organization.Organization
import models.user.{Invite, MultiUser, MultiUserDAO, User}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/* Emails about user accounts: signing up and joining organizations, invites, activation, email verification and
   passwords. */
class AccountEmailService @Inject() (
    multiUserDAO: MultiUserDAO,
    mailchimpClient: MailchimpClient,
    defaultMails: DefaultMails,
    mailSender: MailSender,
    conf: WkConf
)(implicit ec: ExecutionContext) {

  /* Welcomes the new user and tells the organization's new-user mailing list about them.
     On webknossos.org, the user is registered with Mailchimp instead, which sends the welcome emails there.
     The recipient lookup runs in the background, so that it can't fail the signup, which has already been persisted. */
  def sendSignupEmails(user: User, multiUser: MultiUser, organization: Organization, autoActivate: Boolean): Unit = {
    if (conf.Features.isWkorgInstance) {
      mailchimpClient.registerUser(user, multiUser, tag = MailchimpTag.RegisteredAsUser)
    } else {
      mailSender.send(defaultMails.newUserMail(multiUser.fullName, multiUser.email, autoActivate))
    }
    sendNewUserEmail(multiUser, organization, autoActivate)
  }

  /* Welcomes a user who just created a new organization. Only on webknossos.org, where the user is registered with
     Mailchimp, which sends the welcome emails there. */
  def sendOrganizationCreatorWelcome(user: User, multiUser: MultiUser): Unit =
    if (conf.Features.isWkorgInstance) {
      mailchimpClient.registerUser(user, multiUser, MailchimpTag.RegisteredAsAdmin)
    }

  // Tells the organization's new-user mailing list, or its owner if there is none, that an existing user joined.
  def sendUserJoinedEmail(multiUser: MultiUser, organization: Organization, autoActivate: Boolean): Unit =
    sendNewUserEmail(multiUser, organization, autoActivate)

  private def sendNewUserEmail(multiUser: MultiUser, organization: Organization, autoActivate: Boolean): Unit =
    mailSender.inBackground(s"new user ${multiUser._id} in organization ${organization._id}") {
      for {
        recipient <- newUserEmailRecipient(organization)
      } yield mailSender.send(
        defaultMails
          .registerAdminNotifierMail(multiUser.fullName, multiUser.email, organization, autoActivate, recipient)
      )
    }

  def sendInviteEmail(recipient: String, invite: Invite, organization: Organization, sender: MultiUser): Unit =
    mailSender.send(
      defaultMails.inviteMail(recipient, invite.tokenValue, invite.autoActivate, organization.name, sender.fullName)
    )

  def sendActivatedEmail(name: String, email: String): Unit =
    mailSender.send(defaultMails.activatedMail(name, email))

  def sendEmailVerificationEmail(multiUser: MultiUser, verificationLink: String): Unit =
    mailSender.send(defaultMails.emailVerificationMail(multiUser, verificationLink))

  def sendResetPasswordEmail(multiUser: MultiUser, resetPasswordToken: String): Unit =
    mailSender.send(defaultMails.resetPasswordMail(multiUser.fullName, multiUser.email, resetPasswordToken))

  def sendPasswordChangedEmail(multiUser: MultiUser): Unit =
    mailSender.send(defaultMails.changePasswordMail(multiUser.fullName, multiUser.email))

  private def newUserEmailRecipient(organization: Organization): Fox[String] =
    if (organization.newUserMailingList.nonEmpty) Fox.successful(organization.newUserMailingList)
    else multiUserDAO.findMultiUserOfOrganizationOwner(organization._id).map(_.email)
}
