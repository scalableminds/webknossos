/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package oxalis.mturk

import java.util.UUID

import scala.collection.JavaConversions._
import scala.collection.JavaConverters._
import scala.concurrent._
import scala.concurrent.duration._

import com.amazonaws.mturk.addon.HITQuestion
import com.amazonaws.mturk.requester._
import com.amazonaws.mturk.service.axis.RequesterService
import com.amazonaws.mturk.util.ClientConfig
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationDAO
import models.mturk._
import models.task._
import models.user.UserService
import play.api.Play._
import play.api.libs.concurrent.Execution.Implicits._

object MTurkService extends LazyLogging with FoxImplicits {

  type HITTypeId = String

  val conf = current.configuration

  lazy val service = new RequesterService(loadConfig)

  val questionFile = conf.getString("amazon.mturk.questionFile").get

  val isSandboxed = conf.getBoolean("amazon.mturk.sandbox").get

  val notificationsUrl = conf.getString("amazon.sqs.endpoint").get + conf.getString("amazon.sqs.queueName").get

  val serverBaseUrl = conf.getString("http.uri").get

  private def loadConfig = {
    val cfg = new ClientConfig()
    cfg.setAccessKeyId(conf.getString("amazon.mturk.accessKey").get)
    cfg.setSecretAccessKey(conf.getString("amazon.mturk.secretKey").get)
    cfg.setRetriableErrors(conf.getStringList("amazon.mturk.retriableErrors").get.toSet.asJava)
    cfg.setRetryAttempts(conf.getInt("amazon.mturk.retryAttempts").get)
    cfg.setRetryDelayMillis(conf.getInt("amazon.mturk.retryDelayMillis").get)
    cfg.setServiceURL(conf.getString("amazon.mturk.serviceUrl").get)
    cfg
  }

  def ensureEnoughFunds(neededFunds: Int): Future[Boolean] = Future {
    blocking {
      val balance = service.getAccountBalance
      logger.info("Got account balance: " + RequesterService.formatCurrency(balance))
      balance > neededFunds
    }
  }

  def handleSubmittedAssignment(assignmentId: String, hitId: String) = {
    def finishIfAnnotationExists(assignment: MTurkAssignment) = {
      assignment.annotations.find(_.assignmentId == assignmentId) match {
        case Some(reference) =>
          for {
            annotation <- AnnotationDAO.findOneById(reference._annotation)(GlobalAccessContext)
            user <- UserService.findOneById(reference._user.stringify, useCache = true)(GlobalAccessContext)
            _ <- annotation.muta.finishAnnotation(user)(GlobalAccessContext)
          } yield true
        case None            =>
          Fox.successful(true)
      }
    }

    for {
      assignment <- MTurkAssignmentDAO.findByHITId(hitId)(GlobalAccessContext)
      result <- finishIfAnnotationExists(assignment)
    } yield result
  }

  def handleAbandonedAssignment(assignmentId: String, hitId: String) = {
    def cancelIfAnnotationExists(assignment: MTurkAssignment) = {
      assignment.annotations.find(_.assignmentId == assignmentId) match {
        case Some(reference) =>
          for {
            annotation <- AnnotationDAO.findOneById(reference._annotation)(GlobalAccessContext)
            _ <- annotation.muta.cancelTask()(GlobalAccessContext)
          } yield true
        case None            =>
          Fox.successful(true)
      }
    }

    for {
      assignment <- MTurkAssignmentDAO.findByHITId(hitId)(GlobalAccessContext)
      result <- cancelIfAnnotationExists(assignment)
    } yield result
  }

  def handleProjectCreation(project: Project, config: MTurkAssignmentConfig): Fox[Boolean] = {
    for {
      hitTypeId <- createHITType(config).toFox
      _ <- setupNotifications(hitTypeId)
      _ <- MTurkProjectDAO.insert(MTurkProject(project.name, hitTypeId, project.team))(GlobalAccessContext)
    } yield true
  }

  def createHITs(project: Project, task: Task): Fox[MTurkAssignment] = {
    val estimatedAmountNeeded = 1
    for {
      _ <- ensureEnoughFunds(estimatedAmountNeeded)
      mtProject <- MTurkProjectDAO.findByProject(project.name)(GlobalAccessContext)
      (hitId, key) <- createSurvey(mtProject.hittypeId, task.instances)
      assignment = MTurkAssignment(task._id, task.team, mtProject._project, hitId, key)
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

  private def qualificationRequirements(config: MTurkAssignmentConfig): Array[QualificationRequirement] = {
    config.requiredQualification match {
      case MTurkAllowEveryone         =>
        null
      case MTurkAllowExperts          =>
        val qualificationRequirement = new QualificationRequirement
        val mastersId = if (isSandboxed) RequesterService.MASTERS_SANDBOX_QUALIFICATION_TYPE_ID
                        else RequesterService.MASTERS_QUALIFICATION_TYPE_ID
        qualificationRequirement.setQualificationTypeId(mastersId)
        qualificationRequirement.setComparator(Comparator.Exists)
        Array(qualificationRequirement)
      case MTurkAllowLowerHitLimit10k =>
        val qualificationRequirement = new QualificationRequirement
        qualificationRequirement.setQualificationTypeId(
          RequesterService.TOTAL_NUMBER_OF_HITS_APPROVED_QUALIFICATION_TYPE_ID)
        qualificationRequirement.setComparator(Comparator.GreaterThanOrEqualTo)
        qualificationRequirement.setIntegerValue(Array(10000))
        Array(qualificationRequirement)
      case MTurkAllowUpperHitLimit10k =>
        val qualificationRequirement = new QualificationRequirement
        qualificationRequirement.setQualificationTypeId(
          RequesterService.TOTAL_NUMBER_OF_HITS_APPROVED_QUALIFICATION_TYPE_ID)
        qualificationRequirement.setComparator(Comparator.LessThanOrEqualTo)
        qualificationRequirement.setIntegerValue(Array(10000))
        Array(qualificationRequirement)
    }
  }

  private def createHITType(config: MTurkAssignmentConfig): Future[HITTypeId] = {
    Future {
      blocking {
        service.registerHITType(
          config.autoApprovalDelayInSeconds,
          config.assignmentDurationInSeconds,
          config.rewardInDollar,
          config.title,
          config.keywords,
          config.description,
          qualificationRequirements(config))
      }
    }
  }

  private def createSurvey(hitType: String, numAssignments: Int): Future[(String, String)] = {
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
      Future {
        blocking {
          service.createHIT(hitType,
            null, null, null, question,
            null, null, null, lifetimeInSeconds,
            numAssignments, requesterAnnotation,
            null, null)
        }
      }

    hitF.map { hit =>

      logger.debug("Created HIT: " + hit.getHITId)

      logger.debug(service.getWebsiteURL + "/mturk/preview?groupId=" + hit.getHITTypeId)

      hit.getHITId -> requesterAnnotation
    }
  }
}
