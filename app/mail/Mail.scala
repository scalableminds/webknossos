package mail

case class Mail(
    from: String = "",
    subject: String = "",
    bodyText: String = "",
    bodyHtml: String = "",
    recipients: List[String] = List(),
    ccRecipients: List[String] = List(),
    bccRecipients: List[String] = List(),
    replyTo: List[String] = List()
)
