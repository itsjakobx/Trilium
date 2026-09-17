import type BNote from "../../../becca/entities/bnote.js";
import { NoteMeta } from "../../../meta.js";
import mdService from "../markdown.js";
import { ZipExportProvider } from "./abstract_provider.js";

export default class MarkdownExportProvider extends ZipExportProvider {

    prepareMeta() { }

    prepareContent(title: string, content: string | Uint8Array, noteMeta: NoteMeta, note?: BNote): string | Uint8Array {
        if (noteMeta.format === "markdown" && typeof content === "string") {
            content = this.rewriteFn(content, noteMeta);
            if (note) {
                content = mdService.fillPropertyBlockValues(content, note);
            }
            content = mdService.toMarkdown(content);

            if (content.trim().length > 0 && !content.startsWith("# ")) {
                content = `\
# ${title}\r
${content}`;
            }
        }
        return content;
    }

    afterDone() { }

}
