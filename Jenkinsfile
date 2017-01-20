ansiColor('xterm') {
  node {

    try {

      notifyBuild("STARTED")

      stage("Prepare") {

        sh "sudo /var/lib/jenkins/fix_workspace.sh \$(basename \$(pwd))"

        checkout scm
        sh "rm -rf packages"

        def commit = sh(returnStdout: true, script: 'git rev-parse HEAD').trim()
        echo "Branch: ${env.BRANCH_NAME}\nCommit: ${commit}\nAuthors: ${formatChangeSets(currentBuild.changeSets)}"

        env.SBT_VERSION_TAG = "sbt-0.13.9_mongo-3.2.1_node-7.x_jdk-8"
        sh "docker pull scalableminds/sbt:${env.SBT_VERSION_TAG}"
      }


      stage("Build") {

        sh "docker-compose run sbt clean compile stage"
        sh "docker build -t scalableminds/webknossos:${env.BRANCH_NAME}__${env.BUILD_NUMBER} ."
      }


      stage("Test") {

        sh "docker-compose run webknossos-frontend-linting"
        sh "docker-compose run webknossos-frontend-flow"
        sh "docker-compose run webknossos-frontend-tests"
        retry(3) {
          sh "docker-compose run webknossos-e2e-tests"
        }
        sh """
          DOCKER_TAG=${env.BRANCH_NAME}__${env.BUILD_NUMBER} docker-compose up webknossos &
          sleep 10
          ./test/infrastructure/deployment.bash
          docker-compose down
        """
      }


      stage("Publish docker images") {

        sh "docker login -u ${env.DOCKER_USER} -p ${env.DOCKER_PASS}"
        sh "docker tag scalableminds/webknossos:${env.BRANCH_NAME}__${env.BUILD_NUMBER} scalableminds/webknossos:${env.BRANCH_NAME}"
        sh "docker push scalableminds/webknossos:${env.BRANCH_NAME}__${env.BUILD_NUMBER}"
        sh "docker push scalableminds/webknossos:${env.BRANCH_NAME}"
      }


      stage("Build system packages") {

        env.VERSION = readFile('version').trim()
        sh "./buildtools/make_dist.sh oxalis ${env.BRANCH_NAME} ${env.BUILD_NUMBER}"

        def base_port = 10000
        def ports_per_project = 2000
        def port = base_port + (env.BUILD_NUMBER as Integer) % ports_per_project

        def modes = ["dev", "prod"]
        def pkg_types = ["deb", "rpm"]
        for (int i = 0; i < modes.size(); i++) {
          for (int j = 0; j < pkg_types.size(); j++) {
            sh "./buildtools/build-helper.sh oxalis ${env.BRANCH_NAME} ${env.BUILD_NUMBER} ${port} ${modes[i]} ${pkg_types[j]}"
          }
        }

        sh "mkdir packages && mv *.deb packages && mv *.rpm packages"
      }


      stage("Publish system packages") {

        sh "echo ${env.BRANCH_NAME} > .git/REAL_BRANCH"
        withEnv(["JOB_NAME=oxalis"]) {
          sh "./buildtools/publish_deb.py"
          sh "./buildtools/salt-redeploy-dev.sh"
        }
      }


      currentBuild.result = "SUCCESS"


    } catch (err) {

      currentBuild.result = "FAILURE"
      echo err.toString()
      throw err

    } finally {

      stage("Cleanup") {

        archiveArtifacts(artifacts: 'packages/*,errorShots/*', fingerprint: true)
        sh 'docker-compose down || echo "Can not run docker-compose down"'

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

  def message = "${env.JOB_NAME} #${env.BUILD_NUMBER} - ${subject} (<${env.BUILD_URL}|Open>)"
  // Send notifications
  slackSend(channel: '#webknossos-bots', color: colorCode, message: message)
}
