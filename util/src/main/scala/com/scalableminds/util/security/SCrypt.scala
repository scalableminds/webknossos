package com.scalableminds.util.security

/**
  * Making BCrypt look prettier
  */
object SCrypt {

  import java.security.{MessageDigest, SecureRandom}

  /**
    * For readability.
    */
  type PlainPassword = String
  type Salt = String
  type PasswordHash = String

  /**
    * Useful salting default
    */
  val QuickAndWeak = 6
  val GoodEnough = 10
  val RatherTough = 14
  val PrettyInsane = 18

  /**
    * For Scala-bility
    */
  private val random: SecureRandom = new SecureRandom

  private def saltGenerator(rounds: Int) = BCrypt.gensalt(rounds, random)

  /**
    * And for the actual API
    *
    * @param rounds - this is the base of log2 of the number of salting rounds. Legal values are >=4, sane values are <=20
    */
  def hashPassword(password: PlainPassword, rounds: Int = GoodEnough): PasswordHash = {

    if (rounds < 4 && rounds > 20)
      throw new IllegalArgumentException("""As the number of operations grows
                                              	 |with 2^rounds, legal/sane values of rounds are in fixed in (4..20).
                                              |Smaller is less secure, larger is significantly slower""".stripMargin)

    BCrypt.hashpw(password, saltGenerator(rounds))
  }

  /**
    * Sort of self-explanatory :)
    */
  def verifyPassword(plainTextPassword: PlainPassword, hashedPassword: PasswordHash): Boolean =
    hashedPassword.compareTo(BCrypt.hashpw(plainTextPassword, hashedPassword)) == 0

  def md5(s: String): String =
    MessageDigest.getInstance("MD5").digest(s.getBytes).map("%02X".format(_)).mkString
}
