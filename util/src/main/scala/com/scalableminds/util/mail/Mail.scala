/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.mail;

case class Mail(
    from: String = "",
    subject: String = "",
    bodyText: String = "",
    bodyHtml: String = "",
    recipients: List[String] = List(),
    ccRecipients: List[String] = List(),
    bccRecipients: List[String] = List(),
    contentType: Option[String] = None,
    replyTo: Option[String] = None,
    charset: String = "utf-8",
    headers: Map[String, String] = Map[String, String]() )