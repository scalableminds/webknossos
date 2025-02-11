package mail

import com.scalableminds.util.enumeration.ExtendedEnumeration

object MailchimpTag extends ExtendedEnumeration {
  type MailchimpTag = Value

  val RegisteredAsUser, RegisteredAsAdmin, HasAnnotated, HasInvitedTeam, HasUploadedOwnDataset,
      HasViewedPublishedDataset, WasActiveInWeeksTwoOrThree, WasInactiveInWeeksTwoAndThree = Value

  def format(tag: MailchimpTag): String =
    "[A-Z]".r
      .replaceAllIn(
        tag.toString,
        m =>
          "_" + m.group(0).toLowerCase()
      )
      .drop(1)

  override def fromString(s: String): Option[mail.MailchimpTag.Value] =
    super.fromString(underscoreToCamel(s))

  private def underscoreToCamel(name: String): String = name.split("_").map(_.capitalize).mkString("")
}
