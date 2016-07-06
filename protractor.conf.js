var DOWNLOAD_DIRECTORY = __dirname + '/tmp';

exports.config = {
  baseUrl: 'http://localhost:9000',

  allScriptsTimeout: 20000,

  framework: 'jasmine2',

  jasmineNodeOpts: {
    defaultTimeoutInterval: 20000,
    showTiming: true
  },

  params: {
    'DOWNLOAD_DIRECTORY': DOWNLOAD_DIRECTORY
  },

  capabilities: {
    'browserName': 'chrome',
    'platform': 'ANY',
    'version': 'ANY',
    'chromeOptions': {
      'args': ['show-fps-counter=true', '--no-sandbox', '--test-type=browser'],
      'prefs': {
        'download': {
          'prompt_for_download': false,
          'default_directory': DOWNLOAD_DIRECTORY
        }
      }
    }
  },

  seleniumServerJar: './node_modules/protractor/selenium/selenium-server-standalone-2.52.0.jar',

  specs: [
    'app/assets/javascripts/test/**/*.e2e.coffee'
  ],

  onPrepare: function() {
    browser.ignoreSynchronization = true;
  }

};
