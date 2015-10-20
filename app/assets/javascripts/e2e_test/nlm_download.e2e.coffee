describe 'NML Download', ->
  EC = protractor.ExpectedConditions

  findDownloadButton = ->
    btn = element By.cssContainingText '#explorative-tasks tr > td', '5f5174'
    isPresent = EC.presenceOf(btn)

    browser.wait(isPresent, 10000)
    return btn

  findExplorativeTab = ->
    tab = element By.css '#tab-explorative'
    isPresent = EC.presenceOf tab

    browser.wait isPresent, 10000
    return tab

  openExplorativeTab = ->
    return findExplorativeTab().click()

  beforeEach ->
    # we deal with non-angularized pages
    browser.ignoreSynchronization = true
    browser.get('http://localhost:9000/dashboard')

  it 'should find explorative tab', ->
    expect(findExplorativeTab().isPresent()).toBeTruthy()

  it 'should provide download button', ->
    openExplorativeTab()
    expect(findDownloadButton().isPresent()).toBeTruthy()

  it 'should download an NML file', ->

  it 'should contain expected data', ->
