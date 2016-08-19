package models.mturk

import play.api.libs.json.{JsError, _}

trait MTurkAssignmentQualification {
  def id: String
}

case object MTurkAllowEveryone extends MTurkAssignmentQualification {
  val id = "mt-everyone"
}

case object MTurkAllowExperts extends MTurkAssignmentQualification {
  val id = "mt-expert"
}

case object MTurkAllowUpperHitLimit10k extends MTurkAssignmentQualification {
  val id = "mt-max-10k-hits"
}

case object MTurkAllowLowerHitLimit10k extends MTurkAssignmentQualification {
  val id = "mt-min-10k-hits"
}

object MTurkAssignmentQualification {

  val allExperiences: List[MTurkAssignmentQualification] =
    MTurkAllowEveryone :: MTurkAllowExperts :: MTurkAllowUpperHitLimit10k :: MTurkAllowLowerHitLimit10k :: Nil

  implicit val mturkAssignmentQualificationFormat = new Format[MTurkAssignmentQualification] {
    override def writes(o: MTurkAssignmentQualification): JsValue = {
      JsString(o.id)
    }

    override def reads(json: JsValue): JsResult[MTurkAssignmentQualification] =
      json.asOpt[String].flatMap(s => allExperiences.find(_.id == s)) match {
        case Some(e) => JsSuccess(e)
        case None    => JsError("mturk.qualification.invalid")
      }
  }
}
