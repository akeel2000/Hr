function doGet() {
  const folderId = "REPLACE_WITH_YOUR_FOLDER_ID";
  const folder = DriveApp.getFolderById(folderId);
  const fileIterator = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  const files = [];
  const data = [];

  while (fileIterator.hasNext()) {
    files.push(fileIterator.next());
  }

  files.sort((a, b) => b.getLastUpdated() - a.getLastUpdated());

  const latestFile = files[0];

  if (!latestFile) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, total: 0, data: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const spreadsheet = SpreadsheetApp.openById(latestFile.getId());
  const sheet = spreadsheet.getSheetByName("Data") ?? spreadsheet.getSheets()[0];

  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, total: 0, data: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const rows = sheet.getDataRange().getValues();

  if (rows.length < 2) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, total: 0, data: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const headerCounts = {};
  const headers = rows.shift().map((header) => {
    const baseHeader = String(header).trim().toLowerCase();
    const count = headerCounts[baseHeader] ?? 0;
    headerCounts[baseHeader] = count + 1;

    if (baseHeader === "comission" || baseHeader === "commission" || baseHeader === "commision") {
      return count === 0 ? "client commission" : `ignored commission_${count + 1}`;
    }

    return count ? `${baseHeader}_${count + 1}` : baseHeader;
  });

  rows.forEach((row) => {
    const item = {};

    headers.forEach((header, index) => {
      item[header] = row[index];
    });

    item.sourceFile = latestFile.getName();
    data.push(item);
  });

  return ContentService
    .createTextOutput(
      JSON.stringify({
        success: true,
        total: data.length,
        data: data
      })
    )
    .setMimeType(ContentService.MimeType.JSON);
}
