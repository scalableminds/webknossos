
describe 'Dashboard View', ->

  beforeEach ->
    # we deal with non-angularized pages
    browser.ignoreSynchronization = true
    browser.get('http://localhost:9000/dashboard')


  it 'should have webKnossos page title', ->
    expect(browser.getTitle()).toEqual('webKnossos')


  it 'should use gallery view by default', ->
    element(By.id('tabbable-dashboard')).waitReady()

    tabs = element(By.id('tabbable-dashboard'))
    pagination = tabs.element(By.className('pagination'))
    dataset = tabs.element(By.className('dataset-region'))

    expect(pagination.isPresent()).toBeFalse
    expect(dataset.isPresent()).toBeFalse


  it 'should show "advanced view" button by default', ->
    element(By.id('showAdvancedView')).waitReady()

    advancedViewButton = element(By.id('showAdvancedView'))
    galleryViewButton = element(By.id('showGalleryView'))

    expect(advancedViewButton.isDisplayed()).toBeTruthy
    expect(galleryViewButton.isDisplayed()).toBeFalse
