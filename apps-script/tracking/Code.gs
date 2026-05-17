// OpenSentry Usage Tracker — Google Apps Script
// Deploy as web app (Execute as: Me, Who has access: Anyone)
// POSTs from the simulator append a row to the tracking sheet.

var SHEET_ID = "1y76YHs6o43zxEJxT7l7-HB-5cr_wQKK58cNp5beaTMM";
var SHEET_NAME = "Sheet1";

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  
  try {
    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      return json({ error: "invalid json" }, 400);
    }
    
    var unit = (data.unit || "").trim();
    var name = (data.name || "").trim();
    var email = (data.email || "").trim();
    var scenario = (data.scenario || "").trim();
    
    if (!unit) {
      return json({ error: "unit is required" }, 400);
    }
    
    var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
    var timestamp = new Date().toISOString();
    
    sheet.appendRow([timestamp, unit, name, email, scenario]);
    
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function json(data, status) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
