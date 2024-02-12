"use strict";

import * as vscode from "vscode";
import { window } from "vscode";
import * as azdata from "azdata";
import { TableColumnsQuery, MinQuery } from "./queryConstants";

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "ads-searcheverywhere" is now active!');

	context.subscriptions.push(
		vscode.commands.registerCommand("ads-searcheverywhere.search", async () => {
			let connection = await GetConnection();
			
			await GetItemsAndShowQuickPick(connection);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("ads-searcheverywhere.searchAndCacheClear", async () => {
			let connection = await GetConnection();
			var cache = require("memory-cache");
			cache.clear(connection.connectionId + connection.databaseName);
			await GetItemsAndShowQuickPick(connection);
		})
	);
}

async function GetItemsAndShowQuickPick(
	connection: azdata.connection.ConnectionProfile
) {
	try {
		var cache = require("memory-cache");
		let items: QuickPickItemExtended[];

		items = cache.get(connection.connectionId + connection.databaseName);
		if (items === null) {
			let connectionUri = await azdata.connection.getUriForConnection(connection.connectionId);

			const connectionProvider = azdata.dataprotocol.getProvider<azdata.ConnectionProvider>(
				"MSSQL",
				azdata.DataProviderType.ConnectionProvider
			);
			await connectionProvider.changeDatabase(connectionUri, connection.databaseName);

			let queryProvider = azdata.dataprotocol.getProvider<azdata.QueryProvider>(
				connection.providerId,
				azdata.DataProviderType.QueryProvider
			);

			items = await getMsSqlItems(queryProvider, connectionUri);
			cache.put(connection.connectionId + connection.databaseName, items);
		}

		showQuickPick(items, connection);
	} catch (e: any) {
		vscode.window.showErrorMessage(e.message);
	}
}

async function GetConnection() {
	let connection = await azdata.connection.getCurrentConnection();
	if (!connection) {
		throw new Error("Connect to server before use SearchEverywhere.");
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

			var tableColumns = GetConfiguration("columnsInTable");
			let query = tableColumns ? TableColumnsQuery : MinQuery;

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
	let scriptOperation = GetScriptOperation(result?.description!);

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

function GetConfiguration(configName : string) {
	const settings = vscode.workspace.getConfiguration("searchEverywhere");
	return settings[configName];	
}

function GetScriptOperation(objectType: string): azdata.ScriptOperation {
	switch (objectType) {
		case 'Table': return scriptOperation(GetConfiguration('tableScriptOperation'));
		case 'View': return scriptOperation(GetConfiguration('viewScriptOperation'));
		default: return azdata.ScriptOperation.Alter;
	}
}

function scriptOperation(operation: string): azdata.ScriptOperation {
	switch (operation) {
		case 'Select': return azdata.ScriptOperation.Select;
		case 'Create': return azdata.ScriptOperation.Create;
		case 'Alter': return azdata.ScriptOperation.Alter;
		default: return azdata.ScriptOperation.Select;
	}
}
