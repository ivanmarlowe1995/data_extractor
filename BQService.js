const PAGE_SIZE = 10000;
const MAX_RECORDS = 500000;
const DATASET_ID = 'go2_extract_data_hub'

function getUserEmail() {
  var email = Session.getActiveUser().getEmail();
  Logger.log('User email: ' + email);
  return email;
}

function getColumns(tableId) {
  const serviceAccountKey = SERVICE_ACCOUNT_KEY;

  const accessToken = getOAuthToken(serviceAccountKey);
  const projectId = serviceAccountKey.project_id;
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${DATASET_ID}/tables/${tableId}`;

  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + accessToken
    },
  };

  const response = UrlFetchApp.fetch(url, options);
  const tableResponse = JSON.parse(response.getContentText());

  if (!tableResponse || !tableResponse.schema || !tableResponse.schema.fields) {
    return [];
  }

  // Sort the column names alphabetically before returning
  const columns = tableResponse.schema.fields
    .map(field => field.name)
    .sort(); // Added sort method here

  return columns;
}



// function extractAllDataset() {
//   const serviceAccountKey = SERVICE_ACCOUNT_KEY;

//   const accessToken = getOAuthToken(serviceAccountKey);

//   const projectId = serviceAccountKey.project_id;
//   const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`;
//   const options = {
//     method: 'get',
//     headers: {
//       Authorization: 'Bearer ' + accessToken
//     },
//   };
// 
//   const response = UrlFetchApp.fetch(url, options);
//   const datasetsResponse = JSON.parse(response.getContentText());

//   if (!datasetsResponse || !datasetsResponse.datasets) {
//     return [];
//   }

//   const datasets = datasetsResponse.datasets.map(dataset => dataset.datasetReference.datasetId);
//   return datasets;
// }

function extractAllTables() {
  const serviceAccountKey = SERVICE_ACCOUNT_KEY;

  const accessToken = getOAuthToken(serviceAccountKey);

  const projectId = serviceAccountKey.project_id;
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${DATASET_ID}/tables`;
  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + accessToken
    },
  };

  const response = UrlFetchApp.fetch(url, options);
  const tablesResponse = JSON.parse(response.getContentText());

  if (!tablesResponse || !tablesResponse.tables) {
    return [];
  }

  const tables = tablesResponse.tables.map(table => table.tableReference.tableId);
  return tables;
}

function countRecords(tableId, filterStatement, recordLimit) {
  const projectId = userProperties["BIGQUERY_PROJECT_ID"];
  var limitClause = recordLimit ? `LIMIT ${recordLimit}` : "";
  var whereClause = filterStatement ? `WHERE ${filterStatement}` : "";

  var query = `SELECT COUNT(*) as count FROM (SELECT * FROM \`${projectId}.${DATASET_ID}.${tableId}\` ${whereClause} ${limitClause})`;
  var queryResults = executeQuery(query, projectId);
  var count = queryResults.rows[0].f[0].v;

  if (count > MAX_RECORDS) {
    throw new Error(`Count exceeds ${MAX_RECORDS} records`);
  }

  return count;
}

function extractRawDataFromBigQuery(tableId, filterStatement, selectedColumns, orderByColumns, recordLimit, pageSize) {
  const projectId = userProperties["BIGQUERY_PROJECT_ID"];
  var selectClause = selectedColumns && selectedColumns.length > 0 ? selectedColumns.map(column => `\`${column}\``).join(', ') : '*';
  var whereClause = filterStatement ? `WHERE ${filterStatement}` : '';
  var orderByClause = orderByColumns ? `ORDER BY ${orderByColumns}` : '';
  var limitClause = recordLimit ? `LIMIT ${recordLimit}` : '';

  // Count the total records and enforce the record limit
  var totalRows = countRecords(tableId, filterStatement, recordLimit);

  var offset = 0;
  var allRows = [];
  var headers = null;

  var tempTableName = `go2_tmp.temp_table_${new Date().getTime()}`;

  // Create temporary table with row numbers
  var tempTableQuery = `
    CREATE OR REPLACE TABLE ${tempTableName} AS
    SELECT ${selectClause}, ROW_NUMBER() OVER (${orderByClause ? `${orderByClause}` : ''}) as rn
    FROM \`${projectId}.${DATASET_ID}.${tableId}\` ${whereClause} ${limitClause};
  `;
  executeQuery(tempTableQuery, projectId);

  while (offset < totalRows) {
    var query = `
      SELECT * EXCEPT (rn) FROM ${tempTableName}
      ORDER BY rn
      LIMIT ${pageSize} OFFSET ${offset};
    `;
    var queryResults = executeQuery(query, projectId);
    var rows = queryResults.rows;

    if (!rows) {
      throw new Error("Query returned no rows.");
    }

    var fields = queryResults.schema.fields;
    headers = fields.map(field => field.name);

    // Transform rows to handle Unix timestamps
    var transformedRows = rows.map(row => {
      return row.f.map((field, index) => {
        if (fields[index].type === 'TIMESTAMP') {
          var timestampMillis = field.v * 1000;
          return Utilities.formatDate(new Date(timestampMillis), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
        } else {
          return field.v;
        }
      });
    });

    allRows = allRows.concat(transformedRows);
    offset += pageSize;
  }

  return { headers: headers, rows: allRows };
}

function executeQuery(query, projectId) {
  const serviceAccountKey = SERVICE_ACCOUNT_KEY;

  const token = getOAuthToken(serviceAccountKey);

  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify({
      query: query,
      useLegacySql: false
    })
  };

  const response = UrlFetchApp.fetch(url, options);
  let queryResults = JSON.parse(response.getContentText());

  const jobId = queryResults.jobReference.jobId;
  let results = [];
  let pageToken = null;

  while (!queryResults.jobComplete) {
    Utilities.sleep(1000);
    const jobStatusResponse = UrlFetchApp.fetch(`${url}/${jobId}`, {
      headers: { Authorization: 'Bearer ' + token }
    });
    queryResults = JSON.parse(jobStatusResponse.getContentText());
  }

  do {
    const queryResultsResponse = UrlFetchApp.fetch(`${url}/${jobId}`, {
      headers: { Authorization: 'Bearer ' + token },
      payload: pageToken ? { pageToken: pageToken } : {}
    });
    queryResults = JSON.parse(queryResultsResponse.getContentText());
    results = results.concat(queryResults.rows || []);
    pageToken = queryResults.pageToken;
  } while (pageToken);

  return {
    schema: queryResults.schema,
    rows: results
  };
}

function insertDataIntoSheet(sheetName, headers, rows) {
  var sheet = getOrCreateSheet(sheetName);

  sheet.clear();
  sheet.appendRow(headers);

  writeDataToSheet(sheet, rows, headers);

  return rows;
}

function extractDataFromBigQuery(tableId, sheetName, filterStatement, recordLimit, selectedColumns, orderByColumns) {
  try {
    var { headers, rows } = extractRawDataFromBigQuery(tableId, filterStatement, selectedColumns, orderByColumns, recordLimit, PAGE_SIZE);
    return insertDataIntoSheet(sheetName, headers, rows);
  } catch (error) {
    console.error("Error extracting data from BigQuery and inserting into sheet:", error);
    throw error;
  }
}

function getOrCreateSheet(sheetName) {
  var sheet = sheetName ? SpreadsheetApp.getActive().getSheetByName(sheetName) : SpreadsheetApp.getActive().getActiveSheet();
  if (!sheet) {
    sheet = SpreadsheetApp.getActive().insertSheet(sheetName);
  }
  return sheet;
}

function writeDataToSheet(sheet, rows, headers) {
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const batchRows = rows.slice(i, i + PAGE_SIZE);
    sheet.getRange(sheet.getLastRow() + 1, 1, batchRows.length, batchRows[0].length).setValues(batchRows);
  }

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight("bold");
}