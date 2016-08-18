/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package oxalis.mturk

import java.util.UUID

import com.amazonaws.mturk.addon.HITQuestion
import com.amazonaws.mturk.requester._
import com.amazonaws.mturk.service.axis.RequesterService
import com.amazonaws.mturk.util.PropertiesClientConfig
import com.typesafe.scalalogging.LazyLogging
import scala.concurrent.duration._
import scala.collection.JavaConversions._
import scala.concurrent._

import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.mturk._
import models.task._
import play.api.Play._
import play.api.libs.concurrent.Execution.Implicits._

object MTurkService extends LazyLogging with FoxImplicits{
  type HITTypeId = String

  val conf = current.configuration

  lazy val service =  new RequesterService(new PropertiesClientConfig("conf/mturk/mturk.properties"))

  val questionFile: String = "conf/mturk/project_hit_template.question"

  val notificationsUrl = "https://sqs.eu-west-1.amazonaws.com/404539411561/mturk"

  val serverBaseUrl = conf.getString("http.uri").get

  def ensureEnoughFunds(neededFunds: Int): Future[Boolean] = Future{
    blocking {
      val balance = service.getAccountBalance
      logger.info("Got account balance: " + RequesterService.formatCurrency(balance))
      balance > neededFunds
    }
  }

  def handleProjectCreation(project: Project, config: MTurkAssignmentConfig): Fox[Boolean] = {
    for{
      hitTypeId <- createHITType(config).toFox
      _ <- setupNotifications(hitTypeId)
      _ <- MTurkProjectDAO.insert(MTurkProject(project.name, hitTypeId, project.team))(GlobalAccessContext)
    } yield true
  }

  def createHITs(project: Project, task: Task): Fox[MTurkAssignment] = {
    val estimatedAmountNeeded = 1

    for{
      _ <- ensureEnoughFunds(estimatedAmountNeeded)
      mtProject <- MTurkProjectDAO.findByProject(project.name)(GlobalAccessContext)
      key <- createSurvey(mtProject.hittypeId, task.instances)
      assignment = MTurkAssignment(task._id, task.team, mtProject._project, key)
      _ <- MTurkAssignmentDAO.insert(assignment)(GlobalAccessContext)
    } yield {
      assignment
    }
  }

  private def setupNotifications(hITTypeId: HITTypeId): Future[Unit] = {
    val eventTypes = Array[EventType](
      EventType.AssignmentAbandoned, EventType.HITReviewable, EventType.HITExpired,
      EventType.AssignmentReturned, EventType.AssignmentSubmitted)
    val notification = new NotificationSpecification(
      notificationsUrl, NotificationTransport.SQS, "2006-05-05", eventTypes)

    Future(blocking(service.setHITTypeNotification(hITTypeId, notification, true)))
  }

  private def createHITType(config: MTurkAssignmentConfig): Future[HITTypeId] = {
    Future {
      //    val qualificationRequirement = new QualificationRequirement
      //    locationQualReq.setQualificationTypeId
      blocking {
        service.registerHITType(
          config.autoApprovalDelayInSeconds,
          config.assignmentDurationInSeconds,
          config.rewardInDollar,
          config.title,
          config.keywords,
          config.description,
          Array.empty)
      }
    }
  }

  private def createSurvey(hitType: String, numAssignments: Int): Future[String] = {
    // Loading the question (QAP) file. HITQuestion is a helper class that
    // contains the QAP of the HIT defined in the external file. This feature
    // allows you to write the entire QAP externally as a file and be able to
    // modify it without recompiling your code.
    val questionTemplate = new HITQuestion(questionFile)

    val requesterAnnotation = UUID.randomUUID().toString

    val lifetimeInSeconds = 7.days.toSeconds

    val question = questionTemplate.getQuestion(Map("webknossosUrl" -> s"$serverBaseUrl/hits/$requesterAnnotation?"))

    //Creating the HIT and loading it into Mechanical Turk
    val hitF: Future[HIT] =
      Future{
        blocking {
          service.createHIT(hitType, null, null, null, question, null, null, null, lifetimeInSeconds, numAssignments, requesterAnnotation, null, null)
        }
      }

    hitF.foreach { hit =>

      logger.info("Created HIT: " + hit.getHITId)

      logger.info("You may see your HIT with HITTypeId '" + hit.getHITTypeId + "' here: ")

      logger.info(service.getWebsiteURL + "/mturk/preview?groupId=" + hit.getHITTypeId)

      //Demonstrates how a HIT can be retrieved if you know its HIT ID
      val hit2: HIT = service.getHIT(hit.getHITId)

      logger.info("Retrieved HIT: " + hit2.getHITId)

      if (hit.getHITId != hit2.getHITId) {
        logger.error("The HIT Ids should match: " + hit.getHITId + ", " + hit2.getHITId)
      }
    }

    hitF.map(_ => requesterAnnotation)
  }
}
