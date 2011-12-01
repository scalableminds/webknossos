package com.scalableminds.brainflight.snippet

import scala.xml.{NodeSeq, Text}

import net.liftweb._
import common._
import http.{Factory, NoticeType, S, SHtml}
import util.Helpers._

object BootstrapAlerts extends Factory with Loggable {
  /*
   * Config
   */
  val errorTitle = new FactoryMaker[Box[String]](Empty){}
  val warningTitle = new FactoryMaker[Box[String]](Empty){}
  val noticeTitle = new FactoryMaker[Box[String]](Empty){}

  def render = {
    val showAll = toBoolean(S.attr("showAll") or S.attr("showall"))
    val notices =
      if (showAll) S.messages _
      else S.noIdMessages _

    logger.debug("showAll: %s".format(showAll.toString))

    // Compute the formatted set of messages for a given input
    def computeMessageDiv(args: (List[(NodeSeq, Box[String])], NoticeType.Value)): NodeSeq = args match {
      case (messages, noticeType) =>
        // Compute the resulting div
        notices(messages).toList match {
          case msgs if (msgs.length == 0) => Nil
          case msgs if (msgs.length == 1) =>
            <div id={noticeType.id} class={"alert-message %s".format(lowerCaseTitle(noticeType))} data-alert="">
              <a class="close" href="#">&times;</a>
              <p>{noticeTitle(noticeType).map(t => <strong>{t}</strong>).openOr(Text(""))} {msgs(0)}</p>
            </div>
          case msgs =>
            <div id={noticeType.id} class={"alert-message %s".format(lowerCaseTitle(noticeType))} data-alert="">
              {noticeTitle(noticeType).map(t => <strong>{t}</strong>).openOr(Text(""))}
              <a class="close" href="#">&times;</a>
              { msgs.flatMap(e => { <p>{e}</p> }) }
            </div>
        }
    }

    // Render all three types together
    List((S.errors, NoticeType.Error),
         (S.warnings, NoticeType.Warning),
         (S.notices, NoticeType.Notice)).flatMap(computeMessageDiv)
  }

  def lowerCaseTitle(noticeType: NoticeType.Value): String = noticeType match {
    case NoticeType.Notice => "info"
    case _ => noticeType.lowerCaseTitle
  }

  def noticeTitle(noticeType: NoticeType.Value): Box[String] = noticeType match {
    case NoticeType.Notice => noticeTitle.vend
    case NoticeType.Error => errorTitle.vend
    case NoticeType.Warning => warningTitle.vend
  }
}
