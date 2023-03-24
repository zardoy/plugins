import type * as ts from 'typescript/lib/tsserverlibrary';
import * as vscode from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getFormatCodeSettings } from '../configs/getFormatCodeSettings';
import { getUserPreferences } from '../configs/getUserPreferences';
import { safeCall } from '../shared';
import { SharedContext } from '../types';
import { Data, FixAllData, RefactorData } from './codeAction';
import { fileTextChangesToWorkspaceEdit } from './rename';

export function register(ctx: SharedContext) {
	return async (codeAction: vscode.CodeAction) => {

		const data: Data = codeAction.data;
		const document = ctx.getTextDocument(data.uri);
		const [formatOptions, preferences] = document ? await Promise.all([
			getFormatCodeSettings(ctx, document),
			getUserPreferences(ctx, document),
		]) : [{}, {}];

		if (data?.type === 'fixAll') {
			resolveFixAllCodeAction(ctx, codeAction, data, formatOptions, preferences);
		}
		else if (data?.type === 'refactor' && document) {
			resolveRefactorCodeAction(ctx, codeAction, data, document, formatOptions, preferences);
		}
		else if (data?.type === 'organizeImports') {
			resolveOrganizeImportsCodeAction(ctx, codeAction, data, formatOptions, preferences);
		}

		return codeAction;
	};
}

export function resolveFixAllCodeAction(
	ctx: SharedContext,
	codeAction: vscode.CodeAction,
	data: FixAllData,
	formatOptions: ts.FormatCodeSettings,
	preferences: ts.UserPreferences,
) {
	const fixes = data.fixIds.map(fixId => safeCall(() => ctx.typescript.languageService.getCombinedCodeFix({ type: 'file', fileName: data.fileName }, fixId, formatOptions, preferences)));
	const changes = fixes.map(fix => fix?.changes ?? []).flat();
	codeAction.edit = fileTextChangesToWorkspaceEdit(changes, ctx);
}

export function resolveRefactorCodeAction(
	ctx: SharedContext,
	codeAction: vscode.CodeAction,
	data: RefactorData,
	document: TextDocument,
	formatOptions: ts.FormatCodeSettings,
	preferences: ts.UserPreferences,
) {
	const editInfo = safeCall(() => ctx.typescript.languageService.getEditsForRefactor(data.fileName, formatOptions, data.range, data.refactorName, data.actionName, preferences));
	if (!editInfo) {
		return;
	}
	patchBuiltinEditRefactoring(editInfo, codeAction, ctx, data);
	codeAction.edit = fileTextChangesToWorkspaceEdit(editInfo.edits, ctx);
	if (editInfo.renameLocation !== undefined && editInfo.renameFilename !== undefined) {
		codeAction.command = ctx.commands.createRenameCommand(
			document.uri,
			document.positionAt(editInfo.renameLocation),
		);
	}
}

function patchBuiltinEditRefactoring(editInfo: ts.RefactorEditInfo, codeAction: vscode.CodeAction, ctx: SharedContext, data: RefactorData): ts.RefactorEditInfo | void {
	const ts = ctx.typescript.module;
	const sourceFile = ctx.typescript.languageService.getProgram()!.getSourceFile(data.fileName)!;
	const posBeforeStatement = (predicate: (statement: ts.Statement) => boolean) => {
		for (const statement of sourceFile.statements) {
			if (predicate(statement)) return statement.pos + 1;
		}
	};
	let newSecondEditPos: number | undefined;
	switch (codeAction.title) {
		case 'Extract to function in global scope':
			const [vueFile] = ctx!.documents.getVirtualFileByUri(ctx.fileNameToUri(data.fileName.slice(0, -3)));
			if (!vueFile) {
				return;
			}
			newSecondEditPos = sourceFile.getFullText().indexOf('const __VLS_componentsOption') - 1;
			// newSecondEditPos = (vueFile as any).sfc.script.startTagEnd;
			break;
		case 'Extract to function in module scope': {
			newSecondEditPos = posBeforeStatement((statement) => ts.isExportAssignment(statement));
			break;
		}
	}
	if (newSecondEditPos) {
		editInfo.edits[0].textChanges[1].span.start = newSecondEditPos!;
	}
}

export function resolveOrganizeImportsCodeAction(
	ctx: SharedContext,
	codeAction: vscode.CodeAction,
	data: Data,
	formatOptions: ts.FormatCodeSettings,
	preferences: ts.UserPreferences,
) {
	const changes = safeCall(() => ctx.typescript.languageService.organizeImports({ type: 'file', fileName: data.fileName }, formatOptions, preferences));
	codeAction.edit = fileTextChangesToWorkspaceEdit(changes ?? [], ctx);
}
