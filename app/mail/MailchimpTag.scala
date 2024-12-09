package mail

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.typesafe.scalalogging.LazyLogging

object MailchimpTag extends ExtendedEnumeration with LazyLogging {
  type MailchimpTag = Value

  val RegisteredAsUser, RegisteredAsAdmin, HasAnnotated, HasInvitedTeam, HasUploadedOwnDataset,
  HasViewedPublishedDataset, WasActiveInWeeksTwoOrThree, WasInactiveInWeeksTwoAndThree = Value

  def format(tag: MailchimpTag): String = {
    logger.info(f"[debug-regex]: matching $tag to lower-case mailchimp tag")
    "[A-Z]".r
      .replaceAllIn(tag.toString, { m =>
        "_" + m.group(0).toLowerCase()
      })
      .drop(1)
  }

  override def fromString(s: String): Option[mail.MailchimpTag.Value] =
    super.fromString(underscoreToCamel(s))

  private def underscoreToCamel(name: String): String = name.split("_").map(_.capitalize).mkString("")
}
