@Library('jenkins-library@master') _

wrap(repo: "scalableminds/webknossos") {

  stage("Prepare") {

    sh "sudo /var/lib/jenkins/fix_workspace.sh webknossos"

    checkout scm
    sh "rm -rf packages"

    def commit = gitCommit()

    env.DOCKER_CACHE_PREFIX = "~/.webknossos-cache"
    env.COMPOSE_PROJECT_NAME = "webknossos_${env.BRANCH_NAME}_${commit}"
    env.USER_NAME = env.USER
    env.USER_UID = sh(returnStdout: true, script: 'id -u').trim()
    env.USER_GID = sh(returnStdout: true, script: 'id -g').trim()
    sh "mkdir -p ${env.DOCKER_CACHE_PREFIX}"
    sh "docker-compose pull base"
    sh "docker-compose pull mongo"
  }

  stage("Build") {

    sh "docker-compose run base yarn install"
    sh "docker-compose run base yarn run docs"
    sh "docker-compose run base sbt clean compile stage"
    sh "DOCKER_TAG=${env.BRANCH_NAME}__${env.BUILD_NUMBER} docker-compose build --pull webknossos"
  }

  stage("Test") {

    sh "docker-compose run base bash -c \"yarn run lint && yarn run am-i-pretty\""
    sh "docker-compose run base yarn flow"
    sh "docker-compose run base yarn test-verbose"
    retry (3) {
      sh "docker-compose run e2e-tests"
    }
    sh """
      DOCKER_TAG=${env.BRANCH_NAME}__${env.BUILD_NUMBER} docker-compose up webknossos &
      sleep 10
      ./test/infrastructure/deployment.bash
      docker-compose down --volumes --remove-orphans
    """
  }

  dockerPublish(repo: "scalableminds/webknossos")
}
