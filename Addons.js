const userProperties = getUserProperties();

function getUserProperties() {
  var userProperties = PropertiesService.getScriptProperties().getProperties();
  return userProperties;
}

function getActiveSheet(){
  return SpreadsheetApp.getActiveSpreadsheet();
}

function onOpen() {
  SpreadsheetApp.getUi()
      .createAddonMenu()
      .addItem('BQ Data Extractor', 'showSidebar')
      .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Page')
      .evaluate()
      .setTitle('Sheet Add-ons')
      .setWidth(800);

  SpreadsheetApp.getUi()
      .showSidebar(html);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
      .getContent();
}



