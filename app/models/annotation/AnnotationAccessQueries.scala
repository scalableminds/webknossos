package models.annotation

import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SqlInterpolationSyntax, SqlToken, SqlTypeImplicits}

// Kept independent of the DAOs so that DatasetDAO can use it without depending on AnnotationDAO.
object AnnotationAccessQueries extends SqlTypeImplicits with SqlInterpolationSyntax {

  // Annotations owned by the user, or public/internal ones shared with them via a team or contribution.
  // Does not check dataset access: callers must ensure the user can read the annotation's dataset,
  // either via sharedCondition or by only joining datasets that were already access-checked.
  def ownedOrSharedQ(requestingUserId: ObjectId, prefix: SqlToken, sharedCondition: SqlToken = q"TRUE"): SqlToken =
    q"""
        (
          ${prefix}_user = $requestingUserId
          OR (
            (${prefix}visibility = ${AnnotationVisibility.Public} or ${prefix}visibility = ${AnnotationVisibility.Internal})
            AND (
              ${prefix}_id IN (
                SELECT DISTINCT a._annotation
                FROM webknossos.annotation_sharedTeams a
                JOIN webknossos.user_team_roles t ON a._team = t._team
                WHERE t._user = $requestingUserId
              )
              OR
              ${prefix}_id IN (
                SELECT _annotation
                FROM webknossos.annotation_contributors
                WHERE _user = $requestingUserId
              )
            )
            AND $sharedCondition
          )
        )
       """
}
