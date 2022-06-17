// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {
    workspace,
    commands,
    window,
    ExtensionContext,
    languages,
    TextDocument,
    FormattingOptions,
    CancellationToken,
    TextEdit,
    Range,
} from 'vscode';
import { keywords } from './models/keywords';
// Clousure
const keywordsToLowerCase: () => boolean =
    () => workspace.getConfiguration('abap-formatter').get('keywordsToLowerCase') as boolean;

workspace.onDidChangeConfiguration(() => {
    keywordsToLowerCase();
});


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "abap-formatter" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = commands.registerCommand('abap-formatter.helloWorld', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        window.showInformationMessage('Hello World from abap-formatter!');
    });

    context.subscriptions.push(disposable);

    languages.registerDocumentFormattingEditProvider('abap', {
        provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): TextEdit[] {
            console.time('formatting');
            const formattingInLowerCase: boolean = keywordsToLowerCase();
            let aRet: TextEdit[] = [];
            const lines = document.getText().split('\n');
            lines.forEach((line, iLine) => {
                const words: string[] | null =
                    line.match(keywords(formattingInLowerCase));
                if (words && words.length > 0) {
                    words.forEach(word => {
                        const start = line.indexOf(word);
                        const end = start + word.length;
                        aRet.push(TextEdit.replace(new Range(iLine, start, iLine, end), formattingInLowerCase ? word.toLowerCase() : word.toUpperCase()));
                    });
                }
            });

            window.showInformationMessage('onSave from abap-formatter!');
            console.timeEnd('formatting');
            return aRet;
        }
    });
}

// this method is called when your extension is deactivated
export function deactivate() { }
