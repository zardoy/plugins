import type { LanguageServicePlugin, LanguageServicePluginInstance } from '@volar/language-service';
import { format, resolveConfigFile, resolveConfig, Options } from 'prettier';

export default (
	options: {
		/**
		 * Languages to be formatted by prettier.
		 *
		 * @default
		 * ['html', 'css', 'scss', 'typescript', 'javascript']
		 */
		languages?: string[];
		html?: {
			/**
			 * Preprocessing to break "contents" from "HTML tags".
			 * This will prevent HTML closing tags, and opening tags without attributes
			 * from breaking into a blank `>` or `<` on a new line.
			 */
			breakContentsFromTags?: boolean;
		};
		/**
		 * Do not use settings from VSCode's `editor.tabSize` and temporary tabSize on status bar
		 *
		 * @see https://github.com/volarjs/plugins/issues/5
		 */
		ignoreIdeOptions?: boolean,
	} = {},
	getPrettierConfig = () => {
		const configFile = resolveConfigFile.sync();
		if (configFile) {
			return resolveConfig.sync(configFile) ?? {};
		}
		return {};
	},
): LanguageServicePlugin => (context): LanguageServicePluginInstance => {

	if (!context) {
		return {};
	}

	const languages = options.languages ?? ['html', 'css', 'scss', 'typescript', 'javascript'];
	const prettierOptions = getPrettierConfig();

	return {
		provideDocumentFormattingEdits(document, _, formatOptions) {

			if (!languages.includes(document.languageId)) {
				return;
			}

			const fullText = document.getText();
			let oldText = fullText;

			const isHTML = document.languageId === 'html';
			if (isHTML && options.html?.breakContentsFromTags) {
				oldText = oldText
					.replace(/(<[a-z][^>]*>)([^ \n])/gi, '$1 $2')
					.replace(/([^ \n])(<\/[a-z][a-z0-9\t\n\r -]*>)/gi, '$1 $2');
			}

			const currentPrettierConfig: Options = {
				...prettierOptions,
				filepath: context.uriToFileName(document.uri),
			};

			if (!options.ignoreIdeOptions) {
				currentPrettierConfig.useTabs = !formatOptions.insertSpaces;
				currentPrettierConfig.tabWidth = formatOptions.tabSize;
			}

			return [{
				newText: format(oldText, currentPrettierConfig),
				range: {
					start: document.positionAt(0),
					end: document.positionAt(fullText.length),
				},
			}];
		},
	};
};
