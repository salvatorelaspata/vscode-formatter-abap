import { workspace, window, Position, Range, TextEditorEdit, DocumentRangeFormattingEditProvider, TextDocument, FormattingOptions, CancellationToken, TextEdit } from 'vscode';

import { exec, ChildProcess } from 'child_process';
import * as path from 'path';

let open = require('open');
let tmp = require('tmp');
let fs = require('fs');
// import * as fs from 'fs'; // Can't use this because the typed version does not support a property we need. So we're using the require() method instead.

import { Helper } from './helper';

export class Formatter {
    constructor() { }

    /**
     * Applies the appropriate formats to the active text editor.
     * 
     * @param document TextDocument to format. Edits will be applied to this document.
     * @param selection Range to format. If there is no selection, or the selection is empty, the whole document will be formatted.
     */
    public formatDocument(document: TextDocument, selection?: Range) {
        this.getTextEdits(document, selection).then((textEdits) => {
            textEdits.forEach((te) => {
                window.activeTextEditor && window.activeTextEditor.edit((textEditorEdit: TextEditorEdit) => {
                    textEditorEdit.replace(te.range, te.newText);
                });
            });
        });
    }

    /**
     * Returns a Promise with an array of TextEdits that should be applied when formatting.
     * 
     * @param document TextDocument to format. Edits will be applied to this document.
     * @param selection Range to format. If there is no selection, or the selection is empty, the whole document will be formatted.
     * @return Promise with an array of TextEdit.
     */
    public getTextEdits(document: TextDocument, selection?: Range): Thenable<TextEdit[]> {
        return new Promise((resolve, reject) => {
            // Makes our code a little more readable by extracting the config properties into their own variables.
            let config = workspace.getConfiguration('abapformatter');
            let _additionalExtensions: Array<string> = config.get('additionalExtensions', []);
            let _notifications: boolean = config.get('notifications', false);

            if (document.languageId !== 'abap') {
                if (Array.isArray(_additionalExtensions) && _additionalExtensions.indexOf(document.languageId) !== -1) {
                    Helper.logDebug('File is in additionalExtensions array, continuing...');
                } else {
                    let message: string = 'This is neither a .abap file, nor anything that was set in additionalExtensions. Aborting...';
                    Helper.logDebug(message);
                    return reject(message);
                }
            }

            tmp.setGracefulCleanup(); // Temp files should be cleaned up afterwards

            // Variable args will represent the command string.
            // All the arguments for the command will be appended to the array,
            // so they can later be joined and delimited by spaces more easily.
            let args: Array<string> = ['fix'];
            let filePath: string = path.normalize(document.uri.fsPath);

            // Now let's handle anything related to temp files.
            // TODO: Use document.lineCount to warn user about possibly crashing the editor because of having to write the file contents
            Helper.logDebug('Creating temp file.');

            let tempFile: any = tmp.fileSync({ prefix: 'abapfmt-' }); // Create temp file itself (empty).
            let tempFileFd: any = tempFile.fd; // File descriptor of temp file
            let prependedAbapTag: boolean = false; // Whether the to-be-fixed content has a '<?abap' tag prepended or not. This is important, because if there is not such a tag present, we'll have to prepend it ourselves, otherwise ABAP-CS-Fixer won't do anything.
            let contentToFix: string = document.getText(); // The content that should be fixed. If there is a selection, this will be replaced with the selected text.
            filePath = tempFile.name;

            Helper.logDebug('Tempfile fd: ' + tempFile.fd);
            Helper.logDebug('Tempfile name: ' + filePath);
            Helper.logDebug('Writing current document content to temp file. Until VSCode will have a way of querying encoding, utf8 will be used for reading and writing.');

            // First, we'll assume there is no selection, and just select the whole document.
            // Determine the active document's end position (last line, last character).
            let documentEndPosition: Position =
                new Position(document.lineCount - 1,
                    document.lineAt(new Position(document.lineCount - 1, 0)).range.end.character);
            let editRange: Range = new Range(new Position(0, 0), documentEndPosition);

            // If the user made a selection, then only copy the selected text.
            // Also, save that range so we will only replace that part of code after formatting.
            if (selection && Helper.selectionNotEmpty(selection)) {
                let selectionText = document.getText(selection);
                editRange = selection;

                // If the selected text does not have a ABAP opening tag, then
                // prepend one manually. Otherwise ABAP-CS-Fixer will not do
                // anything at all.
                if (selectionText.indexOf('<?') === -1) {
                    Helper.logDebug('No ABAP opening tag found, prepending <?abap to selection');
                    selectionText = '<?abap\n' + selectionText;
                    prependedAbapTag = true;
                }

                contentToFix = selectionText;
            }

            // Write the relevant content to the temp file
            fs.writeFileSync(tempFileFd, contentToFix, { encoding: 'utf8' });

            // Make sure to put double quotes around our path, otherwise the command
            // (Symfony, actually) will fail when it encounters paths with spaces in them.
            let escapedPath = Helper.enquote(filePath);

            args.push(escapedPath);

            let fixCommand: string = args.join(' ');
            // if (_composer) {
            //     // If ABAP-CS-Fixer was installed using Composer, and it was added to the PATH,
            //     // then we don't have to prepend the command with 'abap' or point to the .phar file.
            //     fixCommand = 'abap-cs-fixer ' + args.join(' ');
            // } else {
            //     let message: string = 'Neither a pharPath or use of Composer was specified. Aborting...';
            //     if (_notifications) { window.showInformationMessage(message); }

            //     Helper.logDebug(message);
            //     return reject(message);
            // }

            Helper.logDebug('Full command being executed: ' + fixCommand);

            let stdout: string = '';
            let stderr: string = '';
            let execResult = exec(fixCommand);

            // Output stdout of the fix command result.
            execResult && execResult.stdout && execResult.stdout.on('data', (buffer: string) => {
                stdout += buffer.toString();
            });

            // Output stderr of the fix command result.
            execResult && execResult.stderr && execResult.stderr.on('data', (buffer: string) => {
                stderr += buffer.toString();
            });

            // Handle finishing of the fix command.
            execResult.on('close', (code: any) => {
                if (stdout) {
                    Helper.logDebug('Logging ABAP-CS-Fixer command stdout result');
                    Helper.logDebug(stdout);
                }
                if (stderr) {
                    Helper.logDebug('Logging ABAP-CS-Fixer command stderr result');
                    Helper.logDebug(stderr);
                }

                // Read the content from the temp file. Pass the encoding as utf8,
                // because we need it to return a string (fs would return buffer
                // otherwise, see https://nodejs.org/docs/latest/api/fs.html#fs_fs_readfilesync_file_options)
                // TODO: Detect current document file encoding so we don't have to
                // assume utf8.
                Helper.logDebug('Reading temp file content.');

                // This var will hold the content of the temp file. Every chunk that is read from the ReadStream
                // will be appended to this var.
                let fixedContent: string = '';

                // The reason we are using fs.createReadStream() instead of simply using fs.readFileSync(),
                // is that the latter does not allow you to set the file descriptor cursor position manually.
                // Doing so is crucial, because otherwise only parts of the file will be read in many cases.
                let readStream = fs.createReadStream(filePath, { fd: tempFileFd, start: 0 });

                // Read the data from the file and append it to the string builder.
                readStream.on('data', (chunk: string) => {
                    fixedContent += chunk;
                });

                // When EOF is reached, copy the results back to the original file.
                readStream.on('end', () => {
                    // If we prepended a ABAP opening tag manually, we'll have to remove
                    // it now, before we overwrite our document.
                    if (prependedAbapTag) {
                        fixedContent = fixedContent.substring(6);
                        Helper.logDebug('Removed the prepended ABAP opening tag from the formatted text.');
                    }

                    let numSelectedLines: number = Helper.getNumSelectedLines(editRange, document);
                    Helper.logDebug('Replacing editor content with formatted code.');
                    Helper.logDebug('Document successfully formatted (' + numSelectedLines + ' lines).');

                    let textEdits: TextEdit[] = [];
                    textEdits.push(TextEdit.replace(editRange, fixedContent));
                    return resolve(textEdits);

                    // This does not work for some reason. Keeping this here as a reminder.
                    // tempFile.removeCallback();
                });
            });
        });
    }
}

export class ABAPDocumentRangeFormattingEditProvider implements DocumentRangeFormattingEditProvider {
    private formatter: Formatter;

    constructor() {
        this.formatter = new Formatter();
    }

    public provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Thenable<TextEdit[]> {
        return this.formatter.getTextEdits(document, range);
    }
}