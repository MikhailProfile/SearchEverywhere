export const TableColumnsQuery = `-- Create a temporary table to store the results
CREATE TABLE #TableColumns (
    SchemaName NVARCHAR(128)
    , TableName NVARCHAR(128)
    , ColumnList NVARCHAR(MAX)
    )

-- Declare variables for dynamic SQL
DECLARE @schemaName NVARCHAR(128)
DECLARE @tableName NVARCHAR(128)
DECLARE @sql NVARCHAR(MAX)

-- Cursor to iterate through each table
DECLARE tableCursor CURSOR
FOR
SELECT TABLE_SCHEMA
    , TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE' -- Exclude views
-- Loop through each table and generate dynamic SQL

OPEN tableCursor

FETCH NEXT
FROM tableCursor
INTO @schemaName
    , @tableName

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = 'INSERT INTO #TableColumns (SchemaName, TableName, ColumnList) ' 
    + 'SELECT ''' + @schemaName + ''', ''' + @tableName + ''', ' 
    + 'STUFF((SELECT '', '' + COLUMN_NAME ' + 'FROM INFORMATION_SCHEMA.COLUMNS ' + 'WHERE TABLE_SCHEMA = ''' 
    + @schemaName + ''' ' + 'AND TABLE_NAME = ''' 
    + @tableName + ''' ' + 'FOR XML PATH('''')), 1, 2, '''')'

    EXEC sp_executesql @sql

    FETCH NEXT
    FROM tableCursor
    INTO @schemaName
        , @tableName
END

-- Close and deallocate the cursor
CLOSE tableCursor

DEALLOCATE tableCursor

SELECT o.name AS name
    , 'TABLE' AS type
    , tableColumns.ColumnList AS DEFINITION
    , ss.name AS schemaName
FROM sys.objects AS o
JOIN sys.schemas AS ss ON o.schema_id = ss.schema_id
JOIN #TableColumns AS tableColumns ON tableColumns.TableName = o.name COLLATE DATABASE_DEFAULT
    AND tableColumns.SchemaName = ss.name COLLATE DATABASE_DEFAULT
WHERE type = 'U'

UNION ALL

SELECT DISTINCT o.name AS name
    , o.type_desc AS type
    , m.DEFINITION COLLATE DATABASE_DEFAULT AS DEFINITION
    , ss.name AS schemaName
FROM sys.sql_modules m
JOIN sys.objects o ON m.object_id = o.object_id
JOIN sys.schemas AS ss ON o.schema_id = ss.schema_id

-- Drop the temporary table
DROP TABLE #TableColumns
`;

export const MinQuery = `SELECT o.name AS name
    , 'TABLE' AS type
    , '' AS DEFINITION
    , ss.name AS schemaName
FROM sys.objects AS o
JOIN sys.schemas AS ss ON o.schema_id = ss.schema_id
WHERE type = 'U'

UNION ALL

SELECT DISTINCT o.name AS name
    , o.type_desc AS type
    , m.DEFINITION AS DEFINITION
    , ss.name AS schemaName
FROM sys.sql_modules m
JOIN sys.objects o ON m.object_id = o.object_id
JOIN sys.schemas AS ss ON o.schema_id = ss.schema_id`;
