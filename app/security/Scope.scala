package security

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.services.AccessMode
import com.scalableminds.webknossos.datastore.services.AccessResourceType

/**
  * Scopes restrict what a token may do, so that a token handed to an AI agent can be limited to, say, reading
  * datasets and writing annotations. They only ever narrow: a scoped token can never do more than its user could.
  *
  * Tokens without scopes (the regular API token, the session cookie) are unrestricted, so nothing about the
  * existing authorization behaviour changes.
  */
object ScopeResource extends ExtendedEnumeration {
  type ScopeResource = Value
  val dataset, annotation, task, project, team, user, organization, job, script, voxelytics, aiModel, meta = Value
}

object ScopeMode extends ExtendedEnumeration {
  type ScopeMode = Value
  val read, write, delete, administrate = Value

  /** read, write and delete are ordered, so that a stronger mode includes the weaker ones.
    *
    * administrate is deliberately not part of that ladder. In WEBKNOSSOS it does not mean "even more than delete", it
    * is a separate capability: the right to manage the datasets of an organization, which is what gates creating them
    * (uploading, exploring a remote dataset, reloading). Ranking it above delete would mean that granting dataset
    * creation also granted dataset deletion, so it is only ever covered by an explicit administrate scope.
    */
  def rank(mode: Value): Int = mode match {
    case `read`         => 1
    case `write`        => 2
    case `delete`       => 3
    case `administrate` => 0
  }

  // The datastore and tracingstore describe their access requests with AccessMode, which is a little richer.
  def fromAccessMode(mode: AccessMode.Value): Value = mode match {
    case AccessMode.list         => read
    case AccessMode.read         => read
    case AccessMode.write        => write
    case AccessMode.delete       => delete
    case AccessMode.administrate => administrate
  }
}

case class Scope(resource: ScopeResource.Value, mode: ScopeMode.Value) {

  // A scope covers everything weaker on the same resource: write also grants read, delete also grants write.
  // administrate stands apart and neither covers nor is covered by the others, see ScopeMode.rank.
  def covers(required: Scope): Boolean =
    resource == required.resource && {
      if (required.mode == ScopeMode.administrate || mode == ScopeMode.administrate) mode == required.mode
      else ScopeMode.rank(mode) >= ScopeMode.rank(required.mode)
    }

  override def toString: String = s"$resource:$mode"
}

object Scope {

  def fromString(s: String): Option[Scope] = s.split(':') match {
    case Array(resourceStr, modeStr) =>
      for {
        resource <- ScopeResource.fromString(resourceStr)
        mode <- ScopeMode.fromString(modeStr)
      } yield Scope(resource, mode)
    case _ => None
  }

  def fromAccessResourceType(resourceType: AccessResourceType.Value): Option[ScopeResource.Value] =
    resourceType match {
      case AccessResourceType.dataset    => Some(ScopeResource.dataset)
      case AccessResourceType.annotation => Some(ScopeResource.annotation)
      case AccessResourceType.tracing    => Some(ScopeResource.annotation) // a tracing is part of an annotation
      case AccessResourceType.jobExport  => Some(ScopeResource.job)
      case AccessResourceType.webknossos => None // internal wk-to-store communication, never scoped
    }

  /**
    * The set of scopes a token carries. Note the difference between "no restriction" (an unscoped token, e.g. the
    * regular API token) and "no permissions at all" (a scoped token with an empty set).
    */
  case class Set(scopes: List[Scope]) {
    def allows(required: Scope): Boolean = scopes.exists(_.covers(required))


    override def toString: String = scopes.mkString(",")
  }

  object Set {
    val empty: Set = Set(List.empty)

    /**
      * Accepts both individual scopes ("dataset:read,annotation:write") and the coarse level names that the UI
      * offers ("write"). "none" yields a token that may do nothing. Unparsable entries are ignored.
      */
    def parse(commaSeparated: String): Set = {
      val entries = commaSeparated.split(',').toList.map(_.trim).filter(_.nonEmpty)
      val fromLevels = entries.flatMap(ScopeMode.fromString).flatMap(level => forLevel(level).scopes)
      Set((entries.flatMap(fromString) ++ fromLevels).distinct)
    }

    /**
      * Resources an agent works on. Covers everything the WEBKNOSSOS Python library talks to, so that the library
      * works fully at the create/modify and delete levels. Note that this includes teams and users, because the
      * library creates teams and updates users (e.g. to assign team memberships).
      *
      * The organization is deliberately left out and stays read-only at every level: an agent has no business
      * changing the organization itself, and nothing in the library does.
      */
    private val contentResources: List[ScopeResource.Value] = List(
      ScopeResource.dataset,
      ScopeResource.annotation,
      ScopeResource.task,
      ScopeResource.project,
      ScopeResource.job,
      ScopeResource.script,
      ScopeResource.aiModel,
      ScopeResource.voxelytics,
      ScopeResource.team,
      ScopeResource.user
    )

    /**
      * The three coarse permission levels offered in the UI. Each grants read on everything, plus the given mode on
      * the resources an agent works on.
      */
    // The explicit way to say "no permissions at all", so that it is not mistaken for a typo.
    val noneLiteral = "none"

    // Rejects values that would silently grant nothing because of a typo, e.g. "raed".
    def isParsable(commaSeparated: String): Boolean = {
      val entries = commaSeparated.split(',').toList.map(_.trim).filter(_.nonEmpty)
      entries.isEmpty || entries == List(noneLiteral) ||
      entries.forall(entry => fromString(entry).isDefined || ScopeMode.fromString(entry).isDefined)
    }

    def forLevel(level: ScopeMode.Value): Set = {
      val perResource = ScopeResource.values.toList.map { resource =>
        if (contentResources.contains(resource)) Scope(resource, level) else Scope(resource, ScopeMode.read)
      }
      // Creating a dataset (uploading it, exploring a remote one) is gated behind administrate on the datastore
      // side, so the levels that promise creating datasets have to grant it explicitly.
      val datasetAdministrate =
        if (ScopeMode.rank(level) >= ScopeMode.rank(ScopeMode.write))
          List(Scope(ScopeResource.dataset, ScopeMode.administrate))
        else List.empty
      Set(perResource ++ datasetAdministrate)
    }

    // Everything an agent is allowed to do by default: look at things and work on annotations, but not delete.
    val defaultForAgents: Set = Set(
      List(
        Scope(ScopeResource.dataset, ScopeMode.read),
        Scope(ScopeResource.annotation, ScopeMode.write),
        Scope(ScopeResource.task, ScopeMode.read),
        Scope(ScopeResource.project, ScopeMode.read),
        Scope(ScopeResource.team, ScopeMode.read),
        Scope(ScopeResource.user, ScopeMode.read),
        Scope(ScopeResource.organization, ScopeMode.read),
        Scope(ScopeResource.job, ScopeMode.read),
        Scope(ScopeResource.script, ScopeMode.read),
        Scope(ScopeResource.voxelytics, ScopeMode.read),
        Scope(ScopeResource.aiModel, ScopeMode.read),
        Scope(ScopeResource.meta, ScopeMode.read)
      )
    )
  }
}
