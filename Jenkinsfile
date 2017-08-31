ansiColor('xterm') {
  node {

    try {

      notifyBuild("STARTED")

      stage("Prepare") {

        sh "sudo /var/lib/jenkins/fix_workspace.sh webknossos-datastore"

        checkout scm
        sh "rm -rf packages"

        def commit = sh(returnStdout: true, script: 'git rev-parse HEAD').trim()
        echo "Branch: ${env.BRANCH_NAME}\nCommit: ${commit}\nAuthors: ${formatChangeSets(currentBuild.changeSets)}"

        env.DOCKER_CACHE_PREFIX = "~/.webknossos-datastore-build-cache"
        env.COMPOSE_PROJECT_NAME = "webknossos_datastore_${env.BRANCH_NAME}_${commit}"
        env.SBT_VERSION_TAG = "sbt-0.13.9_mongo-3.2.1_node-7.x_jdk-8"
        sh "mkdir -p ${env.DOCKER_CACHE_PREFIX}"
        sh "docker-compose pull sbt"
      }


      stage("Build") {
        sh "docker-compose run sbt clean compile stage"
        sh "docker build -t scalableminds/webknossos-datastore:${env.BRANCH_NAME}__${env.BUILD_NUMBER} ."
      }


      stage("Test") {
        sh """
          DOCKER_TAG=${env.BRANCH_NAME}__${env.BUILD_NUMBER} docker-compose up webknossos-datastore &
          sleep 10
          curl -v http://localhost:9090/data/health
          docker-compose down --volumes --remove-orphans
        """
      }


      stage("Publish docker images") {

        sh "docker login -u ${env.DOCKER_USER} -p ${env.DOCKER_PASS}"
        sh "docker tag scalableminds/webknossos-datastore:${env.BRANCH_NAME}__${env.BUILD_NUMBER} scalableminds/webknossos-datastore:${env.BRANCH_NAME}"
        sh "docker push scalableminds/webknossos-datastore:${env.BRANCH_NAME}__${env.BUILD_NUMBER}"
        sh "docker push scalableminds/webknossos-datastore:${env.BRANCH_NAME}"
      }

      currentBuild.result = "SUCCESS"


    } catch (err) {

      currentBuild.result = "FAILURE"
      echo err.toString()
      throw err

    } finally {

      stage("Cleanup") {

        // archiveArtifacts(artifacts: "errorShots/*", fingerprint: true)
        sh "docker-compose down --volumes --remove-orphans || echo \"Can not run docker-compose down\""
        sh "docker rmi scalableminds/webknossos-datastore:${env.BRANCH_NAME}__${env.BUILD_NUMBER} || echo \"Can not remove this image\""
        sh "docker rmi scalableminds/webknossos-datastore:${env.BRANCH_NAME} || echo \"Can not remove this image\""

        notifyBuild(currentBuild.result)

        // Clean directory with docker for file permissions
        sh "docker run -v \$(pwd):/workspace -w /workspace alpine sh -c \"find . -mindepth 1 -delete\""
      }
    }

  }
}


@NonCPS
def formatChangeSets(changeSets) {
  if (changeSets.isEmpty()) {
      return ""
  }
  def authors = []
  def files = []
  changeSets.each { changeSet ->
    changeSet.getItems().each { o ->
      def entry = (hudson.scm.ChangeLogSet.Entry) o
      authors.add(entry.getAuthor().getDisplayName())
      files.addAll(entry.getAffectedFiles())
    }
  }
  "${authors.unique().join(", ")} (${files.unique().size()} file(s) changed)"
}

@NonCPS
def formatDuration(duration) {
  def sec_num = (duration / 1000).intValue()
  def hours = (sec_num / 3600).intValue()
  def minutes = ((sec_num - (hours * 3600)) / 60).intValue()
  def seconds = sec_num - (hours * 3600) - (minutes * 60)

  def output = []
  if (hours > 0) {
    output.push("${hours} h")
  }
  if (minutes > 0) {
    output.push("${minutes} min")
  }
  if (seconds > 0) {
    output.push("${seconds} sec")
  }
  output.join(" ")
}

@NonCPS
def notifyBuild(String buildStatus = 'STARTED') {
  // Source: https://jenkins.io/blog/2016/07/18/pipline-notifications/
  // build status of null means successful
  buildStatus = buildStatus ?: 'SUCCESS'

  def colorCode = ''
  def subject = ''
  long duration = System.currentTimeMillis() - currentBuild.startTimeInMillis.longValue()
  def durationString = formatDuration(duration)

  if (buildStatus == 'STARTED') {
    def changeSetString = formatChangeSets(currentBuild.changeSets)
    if (changeSetString == "") {
      subject = "Started"
    } else {
      subject = "Started by changes from ${changeSetString}"
    }
    colorCode = '#aaaaaa'
  } else if (buildStatus == 'SUCCESS') {
    subject = "Success after ${durationString}"
    colorCode = '#35A64F'
  } else {
    subject = "Failure after ${durationString}"
    colorCode = '#CF0001'
  }

  def message = "${env.JOB_NAME} #${env.BUILD_NUMBER} - ${subject} (<${env.RUN_DISPLAY_URL}|Open>)"
  // Send notifications
  slackSend(channel: '#webknossos-bots', color: colorCode, message: message)
}
