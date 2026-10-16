var _a;
import { Node } from "./node.js";
import { holemWaw } from "./utils/holemWaw.js";
import { convertsQametsQatan } from "./utils/qametsQatan.js";
import { splitGroup, taamim, taamimCaptureGroup } from "./utils/regularExpressions.js";
import { sequence } from "./utils/sequence.js";
import { Word } from "./word.js";
/**
 * Processes and analyzes Hebrew text with niqqud, offering syllabification
 * and breakdown into linguistic components (words, syllables, clusters, chars).
 */
export class Text extends Node {
    #original;
    #options;
    /**
     * Cache for {@link SylOpts.ketivQeres}
     *
     * @privateRemarks
     * This cache can be improved. Currently, it can only check for exact matches.
     * So for example, if you have ketivQere options like this:
     * ```js
     * new Text("לֹא־נִפְלֵ֥את הִוא֙ מִמְּךָ֔ וְלֹ֥א רְחֹקָ֖ה הִֽוא׃", {
     *  ketivQeres: [
     *    { input: "הִוא", output: "הִוא" },
     *  ]
     * })
     * ```
     *
     * The cache will miss because `הִוא֙` and `הִֽוא׃` are not exact matches, even though `ignoreTaamim` is `true`.
     */
    #ketivQereCache = {};
    /**
     * `Text` requires an input string,
     * and has optional arguments for syllabification,
     * which can be read about in the [Syllabification](/guides/syllabification) page
     *
     * @param text input string
     * @param options syllabification options
     */
    constructor(text, options = {}) {
        super();
        this.#options = this.#setOptions(options);
        this.#original = this.#options.allowNoNiqqud ? text : this.#validateInput(text);
    }
    #applyKetivQere(text, kq) {
        const input = kq.input ?? kq.ketiv;
        const output = kq.output ?? kq.qere;
        if (input instanceof RegExp) {
            const match = text.match(kq.input);
            if (match) {
                return typeof output === "string" ? output : output(text, input);
            }
        }
        if (input === text) {
            return typeof output === "string" ? output : output(text, input);
        }
        return null;
    }
    #captureTaamim(text) {
        return text.matchAll(_a.#taamimCaptureGroup);
    }
    #processKetivQeres(text) {
        if (this.#ketivQereCache[text]) {
            return this.#ketivQereCache[text];
        }
        const ketivQeres = this.#options.ketivQeres;
        if (!ketivQeres?.length) {
            return text;
        }
        for (const ketivQere of ketivQeres) {
            // capture white space because it is removed in textWithoutTaamim for easier checking
            const startMatch = text.match(/^\s*/g) ?? "";
            const endMatch = text.match(/\s*$/g);
            const whiteSpaceBefore = startMatch ? startMatch[0] : null;
            const whiteSpaceAfter = endMatch ? endMatch[0] : null;
            const textWithoutTaamim = (ketivQere.ignoreTaamim ? this.#removeTaamim(text) : text).trim();
            const appliedKetivQere = this.#applyKetivQere(textWithoutTaamim, ketivQere);
            if (!appliedKetivQere) {
                // if it doesn't match, trim the text and manually add the whitespace back
                return whiteSpaceBefore + text.trim() + whiteSpaceAfter;
            }
            const taamimChars = ketivQere.captureTaamim ? this.#captureTaamim(text) : null;
            const newText = taamimChars ? this.#setTaamim(appliedKetivQere, taamimChars) : appliedKetivQere;
            this.#ketivQereCache[text] = newText;
            return whiteSpaceBefore + newText + whiteSpaceAfter;
        }
        return text;
    }
    #validateInput(text) {
        const niqqud = /[\u{05B0}-\u{05BC}\u{05C7}]/u;
        if (!niqqud.test(text)) {
            throw new Error("Text must contain niqqud");
        }
        return text;
    }
    #validateKetivQeres(ketivQeres) {
        // if it's undefined, it's fine
        if (!ketivQeres) {
            return true;
        }
        // if there's no ketivQeres, it's fine
        if (!ketivQeres.length) {
            return true;
        }
        // validate the shape of the ketivQeres
        for (const [index, ketivQere] of ketivQeres.entries()) {
            let { input, output } = ketivQere;
            const { ketiv, qere, ignoreTaamim, captureTaamim } = ketivQere;
            if (!input && ketiv) {
                input = ketiv;
            }
            if (input === undefined) {
                throw new Error(`The ketivQere at index ${index} must have an input`);
            }
            if (!(input instanceof RegExp) && typeof input !== "string") {
                throw new Error(`The input property of the ketivQere at index ${index} must be a string or RegExp`);
            }
            if (!output && qere) {
                output = qere;
            }
            if (output === undefined) {
                throw new Error(`The ketivQere at index ${index} must have an output`);
            }
            if (typeof output !== "string" && typeof output !== "function") {
                throw new Error(`The output property of the ketivQere at index ${index} must be a string or function`);
            }
            if (ignoreTaamim && typeof ignoreTaamim !== "boolean") {
                throw new Error(`The ignoreTaamim property of the ketivQere at index ${index} must be a boolean`);
            }
            if (captureTaamim && typeof captureTaamim !== "boolean") {
                throw new Error(`The captureTaamim property of the ketivQere at index ${index} must be a boolean`);
            }
        }
        return true;
    }
    #validateOptions(options) {
        const validOpts = [
            "allowNoNiqqud",
            "article",
            "holemHaser",
            "ketivQeres",
            "longVowels",
            "qametsQatan",
            "shevaAfterMeteg",
            "shevaWithMeteg",
            "sqnmlvy",
            "strict",
            "wawShureq"
        ];
        for (const [k, v] of Object.entries(options)) {
            if (!validOpts.includes(k)) {
                throw new Error(`${k} is not a valid option`);
            }
            if (k === "ketivQeres") {
                this.#validateKetivQeres(v);
                continue;
            }
            if (k === "holemHaser" && !["update", "preserve", "remove"].includes(String(v))) {
                throw new Error(`The value ${String(v)} is not a valid option for ${k}`);
            }
            if (typeof v !== "boolean" && k !== "holemHaser") {
                throw new Error(`The value ${String(v)} is not a valid option for ${k}`);
            }
        }
        return options;
    }
    #removeTaamim(text) {
        return text.replace(taamim, "");
    }
    #setOptions(options) {
        const validOpts = this.#validateOptions(options);
        return {
            allowNoNiqqud: validOpts.allowNoNiqqud ?? false,
            article: validOpts.article ?? true,
            holemHaser: validOpts.holemHaser ?? "preserve",
            ketivQeres: validOpts.ketivQeres?.map((kq) => ({
                ...kq,
                captureTaamim: kq.captureTaamim ?? false,
                ignoreTaamim: kq.ignoreTaamim ?? true
            })) ?? [],
            longVowels: validOpts.longVowels ?? true,
            qametsQatan: validOpts.qametsQatan ?? true,
            shevaAfterMeteg: validOpts.shevaAfterMeteg ?? true,
            shevaWithMeteg: validOpts.shevaWithMeteg ?? true,
            sqnmlvy: validOpts.sqnmlvy ?? true,
            strict: validOpts.strict ?? true,
            wawShureq: validOpts.wawShureq ?? true
        };
    }
    #setTaamim(newText, taamimCapture) {
        return [...taamimCapture].reduce((text, group) => {
            return text.slice(0, group.index) + group[1] + text.slice(group.index);
        }, newText);
    }
    static get #taamimCaptureGroup() {
        return taamimCaptureGroup;
    }
    get #normalized() {
        return this.original.normalize("NFKD");
    }
    get #sanitized() {
        const text = this.#normalized.trim();
        const sequencedChar = sequence(text).flat();
        const sequencedText = sequencedChar.reduce((a, c) => a + c.text, "");
        // split text at spaces and maqqef, spaces are added to the array as separate entries
        const textArr = sequencedText.split(splitGroup).filter((group) => group);
        const mapQQatan = this.#options.qametsQatan ? textArr.map(convertsQametsQatan) : textArr;
        const mapHolemWaw = mapQQatan.map((w) => holemWaw(w, this.#options));
        return mapHolemWaw.join("");
    }
    /**
     * Gets all the {@link Char | Chars} in the Text
     *
     * @returns a one dimensional array of Chars
     *
     * ```typescript
     * const text: Text = new Text("יָד");
     * text.chars;
     * //  [
     * //    Char { original: "י" },
     * //    Char { original: "ָ" },
     * //    Char { original: "ד" }
     * //  ]
     * ```
     */
    get chars() {
        return this.clusters.map((cluster) => cluster.chars).flat();
    }
    /**
     * Gets all the {@link Cluster | Clusters} in the Text
     *
     * @returns a one dimensional array of Clusters
     *
     * ```typescript
     * const text: Text = new Text("יָד");
     * text.clusters;
     * // [
     * //    Cluster { original: "יָ" },
     * //    Cluster { original: "ד" }
     * //  ]
     * ```
     */
    get clusters() {
        return this.syllables.map((syllable) => syllable.clusters).flat();
    }
    /**
     * The original string passed
     *
     * @returns the original string passed
     *
     * @remarks
     * The original string passed to the constructor that has not been normalized or sequenced. See {@link text}
     */
    get original() {
        return this.#original;
    }
    /**
     * Gets all the {@link Syllable | Syllables} in the Text
     *
     * @returns a one dimensional array of Syllables
     *
     * ```typescript
     * const text: Text = new Text("הֲבָרֹות");
     * text.syllables;
     * // [
     * //    Syllable { original: "הֲ" },
     * //    Syllable { original: "בָ" },
     * //    Syllable { original: "רֹות" }
     * //  ]
     * ```
     */
    get syllables() {
        return this.words.map((word) => word.syllables).flat();
    }
    /**
     * Gets the text
     *
     * @returns a string that has been decomposed, sequenced, qamets qatan patterns converted to the appropriate unicode character (U+05C7), and holem-waw sequences corrected
     *
     * @example
     * ```ts
     * import { Text } from "havarotjs";
     * const text = new Text("וַתָּשָׁב");
     * text.text;
     * // וַתָּשׇׁב
     * ```
     */
    get text() {
        return this.words.reduce((a, c) => `${a}${c.text}${c.whiteSpaceAfter ?? ""}`, "");
    }
    /**
     * Gets all the {@link Word | Words} in the Text
     *
     * @returns a one dimensional array of Words
     *
     * @example
     * ```ts
     * const text = new Text("הֲבָרֹות");
     * text.words;
     * // [ Word { original: "הֲבָרֹות" } ]
     * ```
     */
    get words() {
        const split = this.#sanitized.split(splitGroup);
        const groups = split.filter((group) => group);
        const words = groups.map((original) => {
            const word = this.#processKetivQeres(original);
            return new Word(word, this.#options, word !== original ? original : undefined);
        });
        const [first, ...rest] = words;
        first.siblings = rest;
        return words;
    }
}
_a = Text;
//# sourceMappingURL=text.js.map