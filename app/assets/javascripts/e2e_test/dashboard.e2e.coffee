
describe 'Dashboard View', ->

  beforeEach ->
    # we deal with non-angularized pages
    browser.ignoreSynchronization = true
    browser.get('/dashboard')


  it 'should have webKnossos page title', ->
    expect(browser.getTitle()).toEqual('webKnossos')


  it 'should use gallery view by default', ->
    tabs = element(By.id('tabbable-dashboard'))
    pagination = tabs.waitReady().element(By.className('pagination')).waitReady()
    dataset = tabs.waitReady().element(By.className('dataset-region')).waitReady()

    expect(pagination.isPresent()).toBeFalse
    expect(dataset.isPresent()).toBeFalse


  it 'should show "advanced view" button by default', ->
    advancedViewButton = element(By.id('showAdvancedView')).waitReady()
    galleryViewButton = element(By.id('showGalleryView')).waitReady()

    expect(advancedViewButton.isDisplayed()).toBeTruthy
    expect(galleryViewButton.isDisplayed()).toBeFalse
