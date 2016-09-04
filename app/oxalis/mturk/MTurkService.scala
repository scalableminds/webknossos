package oxalis.mturk

import java.util.UUID

import scala.collection.JavaConversions._
import scala.collection.JavaConverters._
import scala.concurrent._
import scala.concurrent.duration._

import com.amazonaws.mturk.addon.HITQuestion
import com.amazonaws.mturk.requester._
import com.amazonaws.mturk.service.axis.RequesterService
import com.amazonaws.mturk.service.exception.ObjectDoesNotExistException
import com.amazonaws.mturk.util.ClientConfig
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationDAO, AnnotationService}
import models.mturk._
import models.project.Project
import models.task._
import net.liftweb.common.{Empty, Failure, Full}
import play.api.Play._
import play.api.libs.concurrent.Execution.Implicits._

object MTurkService extends LazyLogging with FoxImplicits {

  type HITTypeId = String

  val conf = current.configuration

  lazy val service = new RequesterService(loadConfig)

  val questionFile = conf.getString("amazon.mturk.questionFile").get

  val isSandboxed = conf.getBoolean("amazon.mturk.sandbox").get

  val submissionUrl = if(isSandboxed) conf.getString("amazon.mturk.submissionUrl.sandbox").get
                      else conf.getString("amazon.mturk.submissionUrl.production").get

  val serverBaseUrl = conf.getString("http.uri").get

  private def loadConfig = {
    val cfg = new ClientConfig()
    cfg.setAccessKeyId(conf.getString("amazon.mturk.accessKey").get)
    cfg.setSecretAccessKey(conf.getString("amazon.mturk.secretKey").get)
    cfg.setRetriableErrors(conf.getStringList("amazon.mturk.retriableErrors").get.toSet.asJava)
    cfg.setRetryAttempts(conf.getInt("amazon.mturk.retryAttempts").get)
    cfg.setRetryDelayMillis(conf.getInt("amazon.mturk.retryDelayMillis").get)
    if(isSandboxed)
      cfg.setServiceURL(conf.getString("amazon.mturk.serviceUrl.sandbox").get)
    else
      cfg.setServiceURL(conf.getString("amazon.mturk.serviceUrl.production").get)
    cfg
  }

  def ensureEnoughFunds(neededFunds: Double): Future[Boolean] = Future {
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
          for{
            annotation <- AnnotationDAO.findOneById(reference._annotation)(GlobalAccessContext)
            _ <- AnnotationService.finish(annotation)(GlobalAccessContext)
          } yield true
        case None            =>
          logger.warn(s"Tried to finish non existent annotation. Hit: $hitId Assignment: $assignmentId")
          Fox.successful(true)
      }
    }

    for {
      assignment <- MTurkAssignmentDAO.findByHITId(hitId)(GlobalAccessContext)
      result <- finishIfAnnotationExists(assignment)
      _ <- MTurkProjectDAO.decreaseNumberOfOpen(assignment._project, 1)(GlobalAccessContext)
      _ <- MTurkAssignmentDAO.decreaseNumberInProgress(hitId, 1)(GlobalAccessContext)
    } yield result
  }

  def handleAcceptedAssignment(assignmentId: String, hitId: String) = {
    for {
      assignment <- MTurkAssignmentDAO.findByHITId(hitId)(GlobalAccessContext)
      _ <- MTurkAssignmentDAO.decreaseNumberOfOpen(hitId, 1)(GlobalAccessContext)
      _ <- MTurkAssignmentDAO.increaseNumberInProgress(hitId, 1)(GlobalAccessContext)
    } yield true
  }

  def handleHITExpired(hitId: String) = {
    for {
      assignment <- MTurkAssignmentDAO.findByHITId(hitId)(GlobalAccessContext)
      _ <- MTurkAssignmentDAO.decreaseNumberOfOpen(hitId,  assignment.numberOfUnfinished)(GlobalAccessContext)
      _ <- MTurkProjectDAO.decreaseNumberOfOpen(hitId, assignment.numberOfUnfinished)(GlobalAccessContext)
    } yield true
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
          logger.warn(s"Tried to cancel non existent annotation. Hit: $hitId Assignment: $assignmentId")
          Fox.successful(true)
      }
    }

    for {
      assignment <- MTurkAssignmentDAO.findByHITId(hitId)(GlobalAccessContext)
      _ <- MTurkAssignmentDAO.increaseNumberOfOpen(hitId, 1)(GlobalAccessContext)
      _ <- MTurkAssignmentDAO.decreaseNumberInProgress(hitId, 1)(GlobalAccessContext)
      result <- cancelIfAnnotationExists(assignment)
    } yield result
  }

  def handleProjectCreation(project: Project, config: MTurkAssignmentConfig): Fox[Boolean] = {
    for {
      hitTypeId <- createHITType(config, Integer.toHexString(project.name.hashCode)).toFox
      notificationUrl <- MTurkNotificationHandler.notificationUrl
      _ <- setupNotifications(hitTypeId, notificationUrl)
      _ <- MTurkProjectDAO.insert(MTurkProject(project.name, hitTypeId, project.team, 0))(GlobalAccessContext)
    } yield true
  }

  def createHITs(project: Project, task: Task): Fox[MTurkAssignment] = {
    for {
      mtProject <- MTurkProjectDAO.findByProject(project.name)(GlobalAccessContext)
      projectConfig <- project.assignmentConfiguration.asOpt[MTurkAssignmentConfig] ?~> "project.config.notMturk"
      _ <- ensureEnoughFunds(projectConfig.rewardInDollar) ?~> "mturk.notEnoughFunds"
      (hitId, key) <- createHIT(mtProject.hitTypeId, task.instances)
      assignment = MTurkAssignment(task._id, task.team, mtProject._project, hitId, key, task.instances, 0)
      _ <- MTurkAssignmentDAO.insert(assignment)(GlobalAccessContext)
      _ <- MTurkProjectDAO.increaseNumberOfOpen(project.name, task.instances)(GlobalAccessContext)
    } yield {
      assignment
    }
  }

  private def setupNotifications(hITTypeId: HITTypeId, url: String): Fox[Boolean] = {
    logger.info(s"Creating hit notifications for '$hITTypeId'. SQS: $url")
    val eventTypes = Array[EventType](
      EventType.AssignmentAbandoned, EventType.AssignmentAccepted, EventType.AssignmentReturned,
      EventType.AssignmentSubmitted, EventType.AssignmentRejected, EventType.HITExpired)
    val notification = new NotificationSpecification(url, NotificationTransport.SQS, "2014-08-15", eventTypes)

    Future(blocking{
      try {
        service.setHITTypeNotification(hITTypeId, notification, true)
        Full(true)
      } catch {
        case e: Exception =>
          logger.error("Failed to create hittype notifications. Error: " + e.getMessage, e)
          Failure("Failed to create hittype notifications. Error: " + e.getMessage, Full(e), Empty)
      }
    })
  }

  private def qualificationRequirements(config: MTurkAssignmentConfig): Array[QualificationRequirement] = {
    config.requiredQualification match {
      case MTurkAllowEveryone         =>
        null
      case MTurkAllowMasters          =>
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

  private def createHITType(config: MTurkAssignmentConfig, uid: String): Fox[HITTypeId] = {
    Future {
      blocking {
        try {
          val id = service.registerHITType(
            config.autoApprovalDelayInSeconds,
            config.assignmentDurationInSeconds,
            config.rewardInDollar,
            config.title,
            config.keywords,
            config.description + " #" + uid,
            qualificationRequirements(config))
          Full(id)
        } catch {
          case e: Exception =>
            logger.error("Failed to create hittype. Eror: "+ e.getMessage, e)
            Failure("Failed to create hittype. Eror: "+ e.getMessage, Full(e), Empty)
        }
      }
    }
  }

  private def createHIT(hitType: String, numAssignments: Int): Fox[(String, String)] = {
    // Loading the question (QAP) file. HITQuestion is a helper class that
    // contains the QAP of the HIT defined in the external file. This feature
    // allows you to write the entire QAP externally as a file and be able to
    // modify it without recompiling your code.
    val questionTemplate = new HITQuestion(questionFile)

    val requesterAnnotation = UUID.randomUUID().toString

    val lifetimeInSeconds = 7.days.toSeconds

    val question = questionTemplate.getQuestion(Map(
      "webknossosUrl" -> s"$serverBaseUrl/hits/$requesterAnnotation?",
      "mturkSubmissionUrl" -> submissionUrl))

    //Creating the HIT and loading it into Mechanical Turk
    val hitF: Fox[HIT] =
      Future {
        blocking {
          try {
            val hit = service.createHIT(hitType,
              null, null, null, question,
              null, null, null, lifetimeInSeconds,
              numAssignments, requesterAnnotation,
              null, null)
            Full(hit)
          } catch {
            case e: Exception =>
              logger.error("Failed to create HIT. Error: " + e.getMessage, e)
              Failure("Failed to create HIT. Error: " + e.getMessage, Full(e), Empty)
          }
        }
      }

    hitF.map { hit =>

      logger.debug("Created HIT: " + hit.getHITId)

      logger.debug(service.getWebsiteURL + "/mturk/preview?groupId=" + hit.getHITTypeId)

      hit.getHITId -> requesterAnnotation
    }
  }

  def removeByTask(task: Task) = {
    def disable(hitId: String): Fox[Boolean] = Future{
      blocking{
        try {
          service.forceExpireHIT(hitId)
          Full(true)
        } catch {
          case e: ObjectDoesNotExistException =>
            // Task is not there any more, so lets assume it is already deleted. This mostly is only the case if
            // one switches from sandbox to production and tries to delete tasks created in sandbox.
            Full(true)
          case e: Exception =>
            logger.error("Failed to disable HIT. Error: " + e.getMessage, e)
            Failure("Failed to disable HIT. Error: " + e.getMessage, Full(e), Empty)
        }
      }
    }

    MTurkAssignmentDAO.findOneByTask(task._id)(GlobalAccessContext).futureBox.flatMap{
      case Full(mtAssignment ) =>
        disable(mtAssignment.hitId)
      case _ =>
        Fox.successful(true)
    }
  }
}
