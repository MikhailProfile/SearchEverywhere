"use strict";

import * as vscode from "vscode";
import { window } from "vscode";
import * as azdata from "azdata";
import { SimpleExecuteResult } from "azdata";

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "ads-searcheverywhere" is now active!');

	context.subscriptions.push(
		vscode.commands.registerCommand("ads-searcheverywhere.search", async () => {
			let connection = await GetConnection();
			let connectionId = connection.connectionId;

			await GetItemsAndShowQuickPick(connectionId, connection);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("ads-searcheverywhere.searchAndCacheClear", async () => {
			let connection = await GetConnection();
			let connectionId = connection.connectionId;
			var cache = require("memory-cache");
			cache.clear(connectionId);
			await GetItemsAndShowQuickPick(connectionId, connection);
		})
	);
}

async function GetItemsAndShowQuickPick(
	connectionId: string,
	connection: azdata.connection.ConnectionProfile
) {
	try {
		var cache = require("memory-cache");
		let items: QuickPickItemExtended[];

		items = cache.get(connectionId);
		if (items === null) {
			let connectionUri = await azdata.connection.getUriForConnection(connectionId);
			let queryProvider = azdata.dataprotocol.getProvider<azdata.QueryProvider>(
				connection.providerId,
				azdata.DataProviderType.QueryProvider
			);

			items = await getMsSqlItems(queryProvider, connectionUri);
			cache.put(connectionId, items);
		}

		showQuickPick(items, connection);
	} catch (e: any) {
		vscode.window.showErrorMessage(e.message);
	}
}

async function GetConnection() {
	let connection = await azdata.connection.getCurrentConnection();
	if (!connection) {
		let connections = await azdata.connection.getActiveConnections();
		if (connections.length === 0) {
			throw new Error("Connect to server before use SearchEverywhere.");
		}

		let firstConnection = connections[0];
		const connectionUri = await azdata.connection.getUriForConnection(firstConnection.connectionId);
		connection = await azdata.connection.getConnection(connectionUri);
	}
	return connection;
}

async function getMsSqlItems(
	queryProvider: azdata.QueryProvider,
	connectionUri: string
): Promise<QuickPickItemExtended[]> {
	
	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
		},
		async (progress) => {
			progress.report({
				message: `Loading server items...`,
			});

			let query = `SELECT o.name AS name
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
JOIN sys.schemas AS ss ON o.schema_id = ss.schema_id
`;

			let results = await queryProvider.runQueryAndReturn(connectionUri, query);
			let cell = results.rows;
			let items = cell.map((element) => {
				let image = "$(account)";
				let typeName = "";
				switch (element[1].displayValue) {
					case "TABLE":
						image = "$(table)";
						typeName = "Table";
						break;
					case "VIEW":
						image = "$(open-preview)";
						typeName = "View";
						break;
					case "SQL_STORED_PROCEDURE":
						image = "$(file-code)";
						typeName = "StoredProcedure";
						break;
					case "SQL_TABLE_VALUED_FUNCTION":
					case "SQL_INLINE_TABLE_VALUED_FUNCTION":
					case "SQL_SCALAR_FUNCTION":
						image = "$(bracket-dot)";
						typeName = "UserDefinedFunction";
						break;
					default:
						break;
				}

				const item: QuickPickItemExtended = {
					label: `${image} ${element[0].displayValue}`,
					detail: element[2].displayValue,
					description: typeName,
					objectName: element[0].displayValue,
					schemaName: element[3].displayValue,
				};

				return item;
			});

			return items;
		}
	);
}

// this method is called when your extension is deactivated
export function deactivate() {
	var cache = require("memory-cache");
	cache.clear();
}

export class QuickPickItemExtended implements vscode.QuickPickItem {
	label!: string;
	kind?: vscode.QuickPickItemKind | undefined;
	description?: string | undefined;
	detail?: string | undefined;
	picked?: boolean | undefined;
	alwaysShow?: boolean | undefined;
	buttons?: readonly vscode.QuickInputButton[] | undefined;
	objectName: string | undefined;
	schemaName: string | undefined;
}

/**
 * Shows a pick list using window.showQuickPick().
 */
export async function showQuickPick(
	items: vscode.QuickPickItem[],
	connection: azdata.connection.ConnectionProfile
) {
	let i = 0;

	const result = (await window.showQuickPick(items, {
		placeHolder: "Provide a search text",
		onDidSelectItem: (item) => {},
		matchOnDetail: true,
	})) as QuickPickItemExtended;

	if (!result) {
		return;
	}

	await handleResult(result, connection);
}
async function handleResult(result: QuickPickItemExtended, connection: azdata.connection.ConnectionProfile) {
	let provider = azdata.dataprotocol.getProvider<azdata.ScriptingProvider>(
		"MSSQL",
		azdata.DataProviderType.ScriptingProvider
	);

	let paramDetails: azdata.ScriptingParamDetails = {
		filePath: "",
		scriptCompatibilityOption: "",
		targetDatabaseEngineEdition: "",
		targetDatabaseEngineType: "",
	};
	// "Table", "StoredProcedure", "View", "UserDefinedFunction",
	let customMetadata: azdata.ObjectMetadata = {
		metadataType: 0,
		metadataTypeName: result?.description!,
		urn: "",
		name: result.objectName!,
		schema: result.schemaName!,
	};
	let scriptOperation =
		result?.description! === "StoredProcedure" || result?.description! === "UserDefinedFunction"
			? azdata.ScriptOperation.Alter
			: azdata.ScriptOperation.Select;

	const connectionUri = await azdata.connection.getUriForConnection(connection.connectionId);
	let script = await provider.scriptAsOperation(
		connectionUri,
		scriptOperation,
		customMetadata,
		paramDetails
	);

	await insertScriptToExistingOrNewEditor(script);
}

async function insertScriptToExistingOrNewEditor(script: azdata.ScriptingResult) {
	let editor = vscode.window.activeTextEditor;

	if (editor?.document.getText().length !== 0) {
		await vscode.commands.executeCommand("newQuery");
	}
	editor = vscode.window.activeTextEditor;

	if (script !== undefined && editor !== undefined) {
		editor.edit((edit) => {
			edit.insert(new vscode.Position(0, 0), script.script);
		});
	}
}
