package oxalis.mail

import com.scalableminds.util.enumeration.ExtendedEnumeration

object MailchimpTag extends ExtendedEnumeration {
  type MailchimpTag = Value

  val RegisteredAsUser, RegisteredAsAdmin, HasAnnotated, HasInvitedTeam, HasUploadedOwnDataset,
  HasViewedPublishedDataset = Value

  def format(tag: MailchimpTag): String =
    "[A-Z]".r
      .replaceAllIn(tag.toString, { m =>
        "_" + m.group(0).toLowerCase()
      })
      .drop(1)
}
