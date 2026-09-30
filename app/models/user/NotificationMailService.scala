package models.user

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.Failure
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import mail.{DefaultMails, Mail, Send}
import models.annotation.Annotation
import models.dataset.{Dataset, DatasetDAO}
import models.organization.OrganizationDAO
import models.project.Project
import models.task.{Task, TaskTypeDAO}
import models.team.{TeamDAO, TeamMembership}
import org.apache.pekko.actor.ActorSystem
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

/* Informs users by email when someone else changes what they have access to or what they should work on:
   annotations and datasets shared with their teams, annotations transferred to them, changes of their team
   memberships and roles, and tasks manually assigned to them. Changes a user makes themselves are never announced.
   The mails are assembled and sent in the background, so that failing to send them never fails the actual change. */
class NotificationMailService @Inject() (
    userDAO: UserDAO,
    multiUserDAO: MultiUserDAO,
    teamDAO: TeamDAO,
    datasetDAO: DatasetDAO,
    organizationDAO: OrganizationDAO,
    taskTypeDAO: TaskTypeDAO,
    defaultMails: DefaultMails,
    conf: WkConf,
    actorSystem: ActorSystem
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  import NotificationMailService.accessChanges

  private lazy val Mailer = actorSystem.actorSelection("/user/mailActor")

  implicit private val ctx: DBAccessContext = GlobalAccessContext

  private def accessChangesEnabled: Boolean = conf.Mail.Notifications.accessChanges
  private def taskAssignmentsEnabled: Boolean = conf.Mail.Notifications.manualTaskAssignments

  def notifyAnnotationSharedWithTeams(
      annotation: Annotation,
      oldTeamIds: List[ObjectId],
      newTeamIds: List[ObjectId],
      sharer: User
  ): Unit = {
    val addedTeamIds = newTeamIds.filterNot(oldTeamIds.contains)
    if (accessChangesEnabled && addedTeamIds.nonEmpty)
      inBackground(s"annotation ${annotation._id} shared with teams $addedTeamIds") {
        for {
          addedTeams <- teamDAO.findAllByIds(addedTeamIds)
          recipients <- newlyReachedUsers(addedTeamIds, oldTeamIds, exclude = Set(sharer._id, annotation._user))
          dataset <- datasetDAO.findOne(annotation._dataset)
          sharerMultiUser <- multiUserDAO.findOne(sharer._multiUser)
          _ <- sendToEach(recipients) { case (recipient, recipientTeamIds) =>
            defaultMails.annotationSharedMail(
              recipient,
              sharerMultiUser.fullName,
              annotation._id,
              annotationName(annotation),
              dataset.name,
              addedTeams.filter(team => recipientTeamIds.contains(team._id)).map(_.name)
            )
          }
        } yield ()
      }
  }

  // Expects the annotation as it is after the transfer, i.e. owned by the new owner.
  def notifyAnnotationTransferred(annotation: Annotation, issuer: User): Unit =
    if (accessChangesEnabled && annotation._user != issuer._id)
      inBackground(s"annotation ${annotation._id} transferred to user ${annotation._user}") {
        for {
          newOwner <- userDAO.findOne(annotation._user)
          recipient <- multiUserDAO.findOne(newOwner._multiUser)
          issuerMultiUser <- multiUserDAO.findOne(issuer._multiUser)
          dataset <- datasetDAO.findOne(annotation._dataset)
        } yield Mailer ! Send(
          defaultMails.annotationTransferredMail(
            recipient,
            issuerMultiUser.fullName,
            annotation._id,
            annotationName(annotation),
            dataset.name
          )
        )
      }

  /* Old and new team ids are those the dataset itself is shared with. Teams that have access through the dataset’s
     folder, as well as admins and dataset managers, could already see the dataset before and are not notified. */
  def notifyDatasetSharedWithTeams(
      dataset: Dataset,
      oldTeamIds: List[ObjectId],
      newTeamIds: List[ObjectId],
      sharer: User
  ): Unit = {
    val addedTeamIds = newTeamIds.filterNot(oldTeamIds.contains)
    if (accessChangesEnabled && addedTeamIds.nonEmpty)
      inBackground(s"dataset ${dataset._id} shared with teams $addedTeamIds") {
        for {
          folderTeamIds <- teamDAO.findAllowedTeamIdsCumulativeForFolder(dataset._folder)
          previousTeamIds = (oldTeamIds ++ folderTeamIds).distinct
          newlyAllowedTeamIds = addedTeamIds.filterNot(previousTeamIds.contains)
          newlyAllowedTeams <- teamDAO.findAllByIds(newlyAllowedTeamIds)
          recipients <- newlyReachedUsers(newlyAllowedTeamIds, previousTeamIds, exclude = Set(sharer._id))
          recipientsWithoutAccessBefore = recipients.filterNot { case (user, _) =>
            user.isAdmin || user.isDatasetManager
          }
          sharerMultiUser <- multiUserDAO.findOne(sharer._multiUser)
          _ <- sendToEach(recipientsWithoutAccessBefore) { case (recipient, recipientTeamIds) =>
            defaultMails.datasetSharedMail(
              recipient,
              sharerMultiUser.fullName,
              dataset._id,
              dataset.name,
              newlyAllowedTeams.filter(team => recipientTeamIds.contains(team._id)).map(_.name)
            )
          }
        } yield ()
      }
  }

  /* Only changes to users that stay active are announced. Newly activated users already get the activation mail,
     which is typically sent together with their initial team memberships. */
  def notifyAccessChanged(
      userBefore: User,
      oldTeamMemberships: List[TeamMembership],
      userAfter: User,
      newTeamMemberships: List[TeamMembership],
      issuer: User
  ): Unit =
    if (accessChangesEnabled && userBefore._id != issuer._id && !userBefore.isDeactivated && !userAfter.isDeactivated)
      inBackground(s"access of user ${userBefore._id} changed") {
        for {
          teams <- teamDAO.findAllByIds((oldTeamMemberships ++ newTeamMemberships).map(_.teamId).distinct)
          changes = accessChanges(
            oldTeamMemberships,
            newTeamMemberships,
            userBefore,
            userAfter,
            teams.map(team => team._id -> team.name).toMap
          )
          _ <- Fox.runIf(changes.nonEmpty)(
            for {
              recipient <- multiUserDAO.findOne(userAfter._multiUser)
              issuerMultiUser <- multiUserDAO.findOne(issuer._multiUser)
              organization <- organizationDAO.findOne(userAfter._organization)
            } yield Mailer ! Send(
              defaultMails.accessChangedMail(recipient, issuerMultiUser.fullName, organization.name, changes)
            )
          )
        } yield ()
      }

  def notifyTaskAssigned(task: Task, project: Project, annotationId: ObjectId, assignee: User, issuer: User): Unit =
    if (taskAssignmentsEnabled && assignee._id != issuer._id)
      inBackground(s"task ${task._id} assigned to user ${assignee._id}") {
        for {
          recipient <- multiUserDAO.findOne(assignee._multiUser)
          issuerMultiUser <- multiUserDAO.findOne(issuer._multiUser)
          taskType <- taskTypeDAO.findOne(task._taskType)
        } yield Mailer ! Send(
          defaultMails
            .taskAssignedMail(recipient, issuerMultiUser.fullName, project.name, taskType.summary, annotationId)
        )
      }

  /* The members of the given teams that were not already members of one of the previous teams, each with the given
     teams they are a member of. Deactivated and unlisted users are left out. */
  private def newlyReachedUsers(
      teamIds: List[ObjectId],
      previousTeamIds: List[ObjectId],
      exclude: Set[ObjectId]
  ): Fox[List[(User, List[ObjectId])]] =
    for {
      previousMembers <- userDAO.findAllByTeams(previousTeamIds)
      previousMemberIds = previousMembers.map(_._id).toSet
      membersPerTeam <- Fox.serialCombined(teamIds)(teamId => userDAO.findAllByTeams(List(teamId)).map(teamId -> _))
      memberships = membersPerTeam.flatMap { case (teamId, members) => members.map(_ -> teamId) }
      teamIdsPerUserId = memberships.groupMap(_._1._id)(_._2)
      users = memberships.map(_._1).distinctBy(_._id)
    } yield users
      .filterNot(user => user.isUnlisted || previousMemberIds.contains(user._id) || exclude.contains(user._id))
      .map(user => user -> teamIdsPerUserId.getOrElse(user._id, List.empty))

  private def sendToEach(recipients: List[(User, List[ObjectId])])(
      mail: (MultiUser, List[ObjectId]) => Mail
  ): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(recipients) { case (user, teamIds) =>
        multiUserDAO.findOne(user._multiUser).map(multiUser => Mailer ! Send(mail(multiUser, teamIds)))
      }
    } yield ()

  private def annotationName(annotation: Annotation): String = annotation.nameOpt.getOrElse("Unnamed Annotation")

  private def inBackground(description: String)(notification: => Fox[Unit]): Unit =
    notification.onComplete {
      case f: Failure => logger.warn(s"Could not send notification mail for $description: $f")
      case _          => ()
    }
}

object NotificationMailService {

  // Human-readable descriptions of how the team memberships and roles of a user changed.
  def accessChanges(
      oldTeamMemberships: List[TeamMembership],
      newTeamMemberships: List[TeamMembership],
      userBefore: User,
      userAfter: User,
      teamNames: Map[ObjectId, String]
  ): List[String] = {
    def teamName(teamId: ObjectId) = teamNames.getOrElse(teamId, teamId.toString)
    val oldById = oldTeamMemberships.map(membership => membership.teamId -> membership).toMap
    val newById = newTeamMemberships.map(membership => membership.teamId -> membership).toMap

    val teamChanges = newTeamMemberships.flatMap { membership =>
      oldById.get(membership.teamId) match {
        case None if membership.isTeamManager =>
          Some(s"You were added to the team ${teamName(membership.teamId)} as team manager.")
        case None => Some(s"You were added to the team ${teamName(membership.teamId)}.")
        case Some(old) if !old.isTeamManager && membership.isTeamManager =>
          Some(s"You are now a team manager of the team ${teamName(membership.teamId)}.")
        case Some(old) if old.isTeamManager && !membership.isTeamManager =>
          Some(s"You are no longer a team manager of the team ${teamName(membership.teamId)}.")
        case _ => None
      }
    } ++ oldTeamMemberships
      .filterNot(membership => newById.contains(membership.teamId))
      .map(membership => s"You were removed from the team ${teamName(membership.teamId)}.")

    val roleChanges = List(
      Option.when(!userBefore.isAdmin && userAfter.isAdmin)("You are now an admin of the organization."),
      Option.when(userBefore.isAdmin && !userAfter.isAdmin)("You are no longer an admin of the organization."),
      Option.when(!userBefore.isDatasetManager && userAfter.isDatasetManager)("You are now a dataset manager."),
      Option.when(userBefore.isDatasetManager && !userAfter.isDatasetManager)("You are no longer a dataset manager.")
    ).flatten

    roleChanges ++ teamChanges
  }
}
