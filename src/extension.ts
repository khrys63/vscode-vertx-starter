import * as vscode from 'vscode';
import * as path from "path";
import * as unzipper from 'unzipper';
import * as request from 'request-promise';

const API_URL = "https://start.vertx.io";
const LANGUAGES = [{ label: "Java", value: "java", }, { label: "Kotlin", value: "kotlin" }];
const BUILD_TOOLS = [{ label: "Maven", value: "maven", }, { label: "Gradle", value: "gradle" }];
const JDK_VERSIONS = [{ label: "JDK 1.8", value: "1.8", }, { label: "JDK 11", value: "11" }];

const CONFIG_API_URL = "vertx-starter.apiUrl";
const CONFIG_DEFAULTS = "vertx-starter.defaults";
const CONFIG_DEFAULTS_GROUP_ID = "groupId";
const CONFIG_DEFAULTS_ARTIFACT_ID = "artifactId";
const CONFIG_DEFAULTS_BUILD_TOOL = "buildTool";
const CONFIG_DEFAULTS_LANGUAGE = "language";
const CONFIG_DEFAULTS_VERTX_VERSION = "vertxVersion";
const CONFIG_DEFAULTS_PACKAGE_NAME = "packageName";
const CONFIG_DEFAULTS_JDK_VERSION = "jdkVersion";

const ID_REGEXP = RegExp('^[A-Za-z0-9_\\-.]+$');
const PACKAGE_NAME_REGEXP = RegExp('^[A-Za-z0-9_\\-.]+$');

export interface Version {
	number: string;
	exclusions: string[];
}

export interface VertxDependency {
	name: string;
	artifactId: string;
	description?: string;
}
export interface StackItem {
	category: string;
	description?: string;
	items: VertxDependency[];
}
export interface Metadata {
	defaults: any;
	stack: StackItem[];
	versions: Version[];
	languages: string[];
	jdkVersions: string[];
	buildTools: string[];
}

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand("vertxStarter.createVertxProject", () => {
		createVertxProject();
	});
	context.subscriptions.push(disposable);
}

async function createVertxProject() {
	const metadata = await getMetadata();
	const versions = metadata.versions.map((it) => {
		return {
			value: it.number,
			label: it.number,
			number: it.number,
			exclusions: it.exclusions
		};
	});

	let defaultVertxVersion = vscode.workspace.getConfiguration(CONFIG_DEFAULTS).get<string>(CONFIG_DEFAULTS_VERTX_VERSION);
	if (!defaultVertxVersion) {
		defaultVertxVersion = metadata.defaults.vertxVersion;
	}
	const vertxVersion = await vscode.window.showQuickPick(
		versions,
		{
			ignoreFocusOut: true,
			placeHolder: "Choose a Vert.x version"
		}
	);
	if (!vertxVersion) {
		vscode.window.showErrorMessage("Impossible to create Vert.x Project: No Vert.x version provided.");
		return;
	}

	let defaultLanguage = vscode.workspace.getConfiguration(CONFIG_DEFAULTS).get<string>(CONFIG_DEFAULTS_LANGUAGE);
	if (!defaultLanguage) {
		defaultLanguage = metadata.defaults.language;
	}
	const language = await vscode.window.showQuickPick(
		LANGUAGES,
		{ ignoreFocusOut: true, placeHolder: "Choose a language" }
	).then((it) => {
		if (it) {
			return it.value;
		}
	});

	let defaultBuildTool = vscode.workspace.getConfiguration(CONFIG_DEFAULTS).get<string>(CONFIG_DEFAULTS_BUILD_TOOL);
	if (!defaultBuildTool) {
		defaultBuildTool = metadata.defaults.buildTool;
	}
	const buildTool = await vscode.window.showQuickPick(
		BUILD_TOOLS,
		{ ignoreFocusOut: true, placeHolder: "Project a build tool" }
	).then((it) => {
		if (it) {
			return it.value;
		}
	});

	let defaultGroupId = vscode.workspace.getConfiguration(CONFIG_DEFAULTS).get<string>(CONFIG_DEFAULTS_GROUP_ID);
	if (!defaultGroupId) {
		defaultGroupId = metadata.defaults.groupId;
	}
	const groupId = await vscode.window.showInputBox(
		{
			ignoreFocusOut: true,
			placeHolder: "Your project group id",
			value: defaultGroupId,
			validateInput: (it) => ID_REGEXP.test(it) ? null : "GroupId invalid"
		}
	);
	if (!groupId) {
		vscode.window.showErrorMessage("Impossible to create Vert.x Project: No groupId provided.");
		return;
	}

	let defaultArtifactId = vscode.workspace.getConfiguration(CONFIG_DEFAULTS).get<string>(CONFIG_DEFAULTS_ARTIFACT_ID);
	if (!defaultArtifactId) {
		defaultArtifactId = metadata.defaults.defaultArtifactId;
	}
	const artifactId = await vscode.window.showInputBox(
		{
			ignoreFocusOut: true,
			placeHolder: "Your project artifact id",
			value: defaultArtifactId,
			validateInput: (it) => ID_REGEXP.test(it) ? null : "ArtifactId invalid"
		}
	);
	if (!artifactId) {
		vscode.window.showErrorMessage("Impossible to create Vert.x Project: No artifactId provided.");
		return;
	}

	const exclusions = (vertxVersion.exclusions) ? vertxVersion.exclusions : [];
	const vertxDependencies = await showDependenciesQuickPick(metadata.stack, exclusions);

	let packageName = "";

	let hasCustomPackageName = await vscode.window.showQuickPick(
		['No', 'Yes'],
		{ ignoreFocusOut: true, placeHolder: "Define a custom package Name?" }
	);
	if (hasCustomPackageName && hasCustomPackageName === 'Yes') {
		let defaultPackageName = vscode.workspace.getConfiguration(CONFIG_DEFAULTS).get<string>(CONFIG_DEFAULTS_PACKAGE_NAME);
		if (!defaultPackageName) {
			defaultPackageName = "";
		}
		let customPackageName = await vscode.window.showInputBox(
			{
				ignoreFocusOut: true,
				placeHolder: "Your project package name",
				value: defaultPackageName,
				validateInput: (it) => PACKAGE_NAME_REGEXP.test(it) ? null : "Package name invalid"
			}
		);
		if (customPackageName) {
			packageName = customPackageName;
		}
	}

	let defaultJdkVersion = vscode.workspace.getConfiguration(CONFIG_DEFAULTS).get<string>(CONFIG_DEFAULTS_JDK_VERSION);
	if (!defaultJdkVersion) {
		defaultJdkVersion = metadata.defaults.jdkVersion;
	}
	const jdkVersion = await vscode.window.showQuickPick(
		JDK_VERSIONS,
		{ ignoreFocusOut: true, placeHolder: "Choose a JDK version" }
	).then((it) => {
		if (it) {
			return it.value;
		}
	});

	const targetDir = await vscode.window.showOpenDialog(
		{ canSelectFiles: false, canSelectFolders: true, canSelectMany: false }
	);
	if (!(targetDir && targetDir[0])) {
		vscode.window.showErrorMessage("Impossible to Create Vert.x Project: No directory provided.");
		return;
	}

	const projectDir = vscode.Uri.file(path.join(targetDir[0].fsPath, artifactId));

	var projectUrl = `${API_URL}/starter.zip?` +
		`groupId=${groupId}&` +
		`artifactId=${artifactId}&` +
		`buildTool=${buildTool}&` +
		`language=${language}&` +
		`vertxVersion=${vertxVersion.number}&` +
		`vertxDependencies=${vertxDependencies.join(',')}&` +
		`packageName=${packageName}&` +
		`jdkVersion=${jdkVersion}`;

	await downloadProject(projectUrl, projectDir);

	let success = await vscode.commands.executeCommand('vscode.openFolder', projectDir, true);
}

async function getMetadata(): Promise<Metadata> {
	return await request.get(`${API_URL}/metadata`)
		.then((body) => {
			const metadata: Metadata = JSON.parse(body);
			return metadata;
		});
}

async function downloadProject(url: string, targetDir: vscode.Uri) {
	return request.get(url, { headers: { 'User-Agent': 'vscode-vertx-starter' } }).pipe(unzipper.Extract({ path: targetDir.fsPath })).promise();
}

export interface VertxDependencyItem {
	artifactId: string;
	artifactName: string;
	artifactDescription?: string;
	categoryName: string;
	categoryDescription?: string;
}
function toVertxDependencyItem(stack: StackItem[], exclusions: string[]): VertxDependencyItem[] {
	const items: VertxDependencyItem[] = [];
	stack.forEach((item) => {
		item.items
			.filter((dependency) => { return exclusions.indexOf(dependency.artifactId) === -1; })
			.forEach((dependency) => {
				items.push({
					artifactId: dependency.artifactId,
					artifactName: dependency.name,
					artifactDescription: dependency.description,
					categoryName: item.category,
					categoryDescription: item.description
				});
			});
	});
	return items;
}

async function showDependenciesQuickPick(stack: StackItem[], exclusions: string[]): Promise<string[]> {
	let selectedDependencies: VertxDependencyItem[] = [];
	let unselectedDependencies: VertxDependencyItem[] = toVertxDependencyItem(stack, exclusions);
	let current: any;
	do {
		//Build item list
		let items = selectedDependencies.concat(unselectedDependencies).map((it) => {
			return {
				value: it.artifactId,
				label: `${selectedDependencies.some((other) => it.artifactId === other.artifactId) ? '$(check) ' : ''}${it.artifactName}`,
				description: it.categoryName,
				detail: it.artifactDescription
			};
		});
		//Push the dependencies selection stopper on top of the dependencies list
		items.unshift({
			value: 'stop',
			label: `$(tasklist) ${selectedDependencies.length} dependencies selected`,
			description: '',
			detail: 'Press <Enter>  to continue'
		});
		current = await vscode.window.showQuickPick(
			items,
			{ ignoreFocusOut: true, matchOnDetail: true, matchOnDescription: true, placeHolder: "Vertx Dependencies" }
		);
		//When a dependency is picked toggle its status (selected/unselected)
		if (current && current.value !== 'stop') {
			//unselected
			if (selectedDependencies.some((it) => { return it.artifactId === current.value; })) {
				selectedDependencies = selectedDependencies.filter((it) => it.artifactId !== current.value);
			} else {
				//select
				let dependency = unselectedDependencies.find(((it) => { return it.artifactId === current.value; }));
				if (dependency) {
					unselectedDependencies = unselectedDependencies.filter((it) => it.artifactId !== current.value);
					selectedDependencies.push(dependency);
				}
			}

		}
	}
	while (current && current.value !== 'stop');

	return selectedDependencies.map((it) => it.artifactId);
}

export function deactivate() { }