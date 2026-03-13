"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Defuddle = void 0;
const metadata_1 = require("./metadata");
const extractor_registry_1 = require("./extractor-registry");
const constants_1 = require("./constants");
const standardize_1 = require("./standardize");
const footnotes_1 = require("./elements/footnotes");
const scoring_1 = require("./scoring");
const utils_1 = require("./utils");
const dom_1 = require("./utils/dom");
/** Keys from extractor variables that map to top-level DefuddleResponse fields */
const STANDARD_VARIABLE_KEYS = new Set(['title', 'author', 'published', 'site', 'description', 'image', 'language']);
// Content pattern detection constants
const CONTENT_DATE_PATTERN = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i;
const CONTENT_READ_TIME_PATTERN = /\d+\s*min(?:ute)?s?\s+read\b/i;
const BOILERPLATE_PATTERNS = [
    /^This (?:article|story|piece) (?:appeared|was published|originally appeared) in\b/i,
    /^A version of this (?:article|story) (?:appeared|was published) in\b/i,
    /^Originally (?:published|appeared) (?:in|on|at)\b/i,
];
const METADATA_STRIP_PATTERNS = [
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/gi,
    /\b\d+(?:st|nd|rd|th)?\b/g,
    /\bmin(?:ute)?s?\b/gi,
    /\bread\b/gi,
    /[|·•—–\-,.\s]/g,
];
class Defuddle {
    /**
     * Create a new Defuddle instance
     * @param doc - The document to parse
     * @param options - Options for parsing
     */
    constructor(doc, options = {}) {
        this._schemaOrgData = undefined;
        this._schemaOrgExtracted = false;
        this.doc = doc;
        this.options = options;
        this.debug = options.debug || false;
    }
    /**
     * Lazily extract and cache schema.org data. Must be called before
     * parse() strips script tags from the document.
     */
    getSchemaOrgData() {
        if (!this._schemaOrgExtracted) {
            this._schemaOrgData = this._extractSchemaOrgData(this.doc);
            this._schemaOrgExtracted = true;
        }
        return this._schemaOrgData;
    }
    /**
     * Parse the document and extract its main content
     */
    parse() {
        // Try first with default settings
        let result = this.parseInternal();
        // If result has very little content, try again without clutter removal
        if (result.wordCount < 200) {
            this._log('Initial parse returned very little content, trying again');
            const retryResult = this.parseInternal({
                removePartialSelectors: false
            });
            // Only use the retry if it produces significantly more content.
            // A small increase likely means partial selectors correctly removed
            // clutter (author blocks, related articles, etc.) from a short article.
            // A large increase (2x+) suggests partial selectors were too aggressive.
            if (retryResult.wordCount > result.wordCount * 2) {
                this._log('Retry produced more content');
                result = retryResult;
            }
        }
        // If still very little content, the page may be an index/listing page
        // where card elements were scored as non-content or removed by partial
        // selectors (e.g. "post-preview"). Retry with both disabled.
        if (result.wordCount < 50) {
            this._log('Still very little content, retrying without scoring/partial selectors (possible index page)');
            const indexRetry = this.parseInternal({
                removeLowScoring: false,
                removePartialSelectors: false,
                removeContentPatterns: false
            });
            if (indexRetry.wordCount > result.wordCount) {
                this._log('Index page retry produced more content');
                result = indexRetry;
            }
        }
        // Strip dangerous elements from this.doc before any fallback paths
        // that read from it (e.g. _findContentBySchemaText).
        // This must happen after parseInternal, which needs script tags
        // for schema.org extraction, site-specific extractors, and math.
        this._stripUnsafeElements();
        // If schema.org has a SocialMediaPosting with text content that is
        // longer than what we extracted, the scorer likely picked the wrong
        // element from a feed. Find the correct element in the DOM.
        const schemaText = this._getSchemaText(result.schemaOrgData);
        if (schemaText && this.countWords(schemaText) > result.wordCount) {
            const contentHtml = this._findContentBySchemaText(schemaText);
            if (contentHtml) {
                this._log('Found DOM content matching schema.org text');
                result.content = contentHtml;
                result.wordCount = this.countWords(contentHtml);
            }
            else {
                this._log('Using schema.org text as content (DOM element not found)');
                result.content = schemaText;
                result.wordCount = this.countWords(schemaText);
            }
        }
        return result;
    }
    /**
     * Extract text content from schema.org data (e.g. SocialMediaPosting, Article)
     */
    _getSchemaText(schemaOrgData) {
        if (!schemaOrgData)
            return '';
        const items = Array.isArray(schemaOrgData) ? schemaOrgData : [schemaOrgData];
        for (const item of items) {
            if (item?.text && typeof item.text === 'string') {
                return item.text;
            }
            if (item?.articleBody && typeof item.articleBody === 'string') {
                return item.articleBody;
            }
        }
        return '';
    }
    /**
     * Remove dangerous elements and attributes from this.doc.
     * Called after parseInternal so that extractors and schema extraction
     * can still read script tags they depend on.
     */
    _stripUnsafeElements() {
        const body = this.doc.body;
        if (!body)
            return;
        // Remove dangerous elements. Iframes are kept — same-origin policy
        // isolates them, and they're widely used for legitimate media embeds.
        // Dangerous iframe attributes (srcdoc, javascript: src) are stripped
        // in the attribute pass below. Math scripts are preserved for LaTeX
        // content (matching the EXACT_SELECTORS approach).
        const dangerousElements = body.querySelectorAll('script:not([type^="math/"]), style, noscript, frame, frameset, object, embed, applet, base');
        for (const el of dangerousElements)
            el.remove();
        // Remove event handler attributes, dangerous URIs, and srcdoc
        const allElements = body.querySelectorAll('*');
        for (const el of allElements) {
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on')) {
                    el.removeAttribute(attr.name);
                }
                else if (name === 'srcdoc') {
                    el.removeAttribute(attr.name);
                }
                else if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name)) {
                    if ((0, dom_1.isDangerousUrl)(attr.value)) {
                        el.removeAttribute(attr.name);
                    }
                }
            }
        }
    }
    /**
     * Find a DOM element whose text matches the schema.org text content.
     * Used when the content scorer picked the wrong element from a feed page.
     * Returns the element's inner HTML including sibling media (images, etc.)
     */
    _findContentBySchemaText(schemaText) {
        const body = this.doc.body;
        if (!body)
            return '';
        // Use the first paragraph as the search phrase.
        // DOM textContent concatenates <p> elements without separators,
        // so we can't cross paragraph boundaries when matching.
        const firstPara = schemaText.split(/\n\s*\n/)[0]?.trim() || '';
        const searchPhrase = firstPara.substring(0, 100).trim();
        if (!searchPhrase)
            return '';
        const schemaWordCount = this.countWords(schemaText);
        // Find the smallest element whose text contains the search phrase
        // and whose word count is close to the schema text's word count
        let bestMatch = null;
        let bestSize = Infinity;
        const allElements = body.querySelectorAll('*');
        for (const el of allElements) {
            const elText = (el.textContent || '');
            if (!elText.includes(searchPhrase))
                continue;
            const elWords = elText.trim().split(/\s+/).length;
            // Element should contain roughly the same amount of text
            // (allow some slack for surrounding whitespace / minor extras)
            if (elWords >= schemaWordCount * 0.8 && elWords < bestSize) {
                bestSize = elWords;
                bestMatch = el;
            }
        }
        if (!bestMatch)
            return '';
        // Read the largest sibling image src BEFORE resolveRelativeUrls
        // can mangle comma-containing CDN URLs in srcset attributes
        let imageSrc = '';
        let imageAlt = '';
        const parent = bestMatch.parentElement;
        if (parent && parent !== body) {
            const images = parent.querySelectorAll('img');
            let largestImg = null;
            let largestArea = 0;
            for (const img of images) {
                if (bestMatch.contains(img))
                    continue;
                const w = parseInt(img.getAttribute('width') || '0', 10);
                const h = parseInt(img.getAttribute('height') || '0', 10);
                const area = w * h;
                if (area > largestArea) {
                    largestArea = area;
                    largestImg = img;
                }
            }
            if (largestImg) {
                imageSrc = this._getLargestImageSrc(largestImg);
                imageAlt = largestImg.getAttribute('alt') || '';
                try {
                    const baseUrl = this.options.url || this.doc.URL;
                    if (baseUrl)
                        imageSrc = new URL(imageSrc, baseUrl).href;
                }
                catch { }
            }
        }
        // Now resolve URLs in the text content
        this.resolveRelativeUrls(bestMatch);
        let html = (0, dom_1.serializeHTML)(bestMatch);
        if (imageSrc) {
            const img = this.doc.createElement('img');
            img.setAttribute('src', imageSrc);
            img.setAttribute('alt', imageAlt);
            html += img.outerHTML;
        }
        return html;
    }
    /**
     * Get the largest available src from an img element,
     * checking srcset for higher-resolution versions.
     */
    _getLargestImageSrc(img) {
        const srcset = img.getAttribute('srcset') || '';
        if (!srcset)
            return img.getAttribute('src') || '';
        // Parse srcset entries: each ends with a width descriptor (e.g. "424w")
        // URLs may contain commas (e.g. Substack CDN), so split on width descriptors
        const entryPattern = /(.+?)\s+(\d+(?:\.\d+)?)w/g;
        let bestUrl = '';
        let bestWidth = 0;
        let match;
        let lastIndex = 0;
        while ((match = entryPattern.exec(srcset)) !== null) {
            let url = match[1].trim();
            if (lastIndex > 0) {
                url = url.replace(/^,\s*/, '');
            }
            lastIndex = entryPattern.lastIndex;
            const width = parseFloat(match[2]);
            if (url && width > bestWidth) {
                bestWidth = width;
                bestUrl = url;
            }
        }
        let url = bestUrl || img.getAttribute('src') || '';
        // Strip CDN width/crop constraints to get the full resolution image
        // (e.g. Cloudinary-style params: ,w_852,c_limit → removed)
        url = url.replace(/,w_\d+/g, '').replace(/,c_\w+/g, '');
        return url;
    }
    /**
     * Parse the document asynchronously. Checks for extractors that prefer
     * async (e.g. YouTube transcripts) before sync, then falls back to async
     * extractors if sync parse yields no content.
     */
    async parseAsync() {
        if (this.options.useAsync !== false) {
            const asyncResult = await this.tryAsyncExtractor(extractor_registry_1.ExtractorRegistry.findPreferredAsyncExtractor.bind(extractor_registry_1.ExtractorRegistry));
            if (asyncResult)
                return asyncResult;
        }
        const result = this.parse();
        if (result.wordCount > 0 || this.options.useAsync === false) {
            return result;
        }
        return (await this.tryAsyncExtractor(extractor_registry_1.ExtractorRegistry.findAsyncExtractor.bind(extractor_registry_1.ExtractorRegistry))) ?? result;
    }
    /**
     * Fetch only async variables (e.g. transcript) without re-parsing.
     * Safe to call after parse() — uses cached schema.org data since
     * parse() strips script tags from the document.
     */
    async fetchAsyncVariables() {
        if (this.options.useAsync === false)
            return null;
        try {
            const url = this.options.url || this.doc.URL;
            const schemaOrgData = this.getSchemaOrgData();
            const extractor = extractor_registry_1.ExtractorRegistry.findPreferredAsyncExtractor(this.doc, url, schemaOrgData);
            if (extractor) {
                const extracted = await extractor.extractAsync();
                return this.getExtractorVariables(extracted.variables) || null;
            }
        }
        catch (error) {
            console.error('Defuddle', 'Error fetching async variables:', error);
        }
        return null;
    }
    async tryAsyncExtractor(finder) {
        try {
            const url = this.options.url || this.doc.URL;
            const schemaOrgData = this.getSchemaOrgData();
            const extractor = finder(this.doc, url, schemaOrgData);
            if (extractor) {
                const startTime = Date.now();
                const extracted = await extractor.extractAsync();
                const pageMetaTags = this._collectMetaTags();
                const metadata = metadata_1.MetadataExtractor.extract(this.doc, schemaOrgData, pageMetaTags);
                return this.buildExtractorResponse(extracted, metadata, startTime, extractor, pageMetaTags);
            }
        }
        catch (error) {
            console.error('Defuddle', 'Error in async extraction:', error);
        }
        return null;
    }
    /**
     * Internal parse method that does the actual work
     */
    parseInternal(overrideOptions = {}) {
        const startTime = Date.now();
        const options = {
            removeExactSelectors: true,
            removePartialSelectors: true,
            removeHiddenElements: true,
            removeLowScoring: true,
            removeSmallImages: true,
            removeContentPatterns: true,
            standardize: true,
            ...this.options,
            ...overrideOptions
        };
        const debugRemovals = [];
        // Extract schema.org data (cached — must happen before _stripUnsafeElements removes scripts)
        const schemaOrgData = this.getSchemaOrgData();
        // Cache meta tags and metadata across retries
        if (!this._metaTags) {
            this._metaTags = this._collectMetaTags();
        }
        const pageMetaTags = this._metaTags;
        if (!this._metadata) {
            this._metadata = metadata_1.MetadataExtractor.extract(this.doc, schemaOrgData, pageMetaTags);
        }
        const metadata = this._metadata;
        if (options.removeImages) {
            this.removeImages(this.doc);
        }
        try {
            // Use site-specific extractor first, if there is one
            const url = options.url || this.doc.URL;
            const extractor = extractor_registry_1.ExtractorRegistry.findExtractor(this.doc, url, schemaOrgData);
            if (extractor && extractor.canExtract()) {
                const extracted = extractor.extract();
                return this.buildExtractorResponse(extracted, metadata, startTime, extractor, pageMetaTags);
            }
            // Continue if there is no extractor...
            // Evaluate mobile styles and sizes on original document (cached across retries)
            if (!this._mobileStyles) {
                this._mobileStyles = this._evaluateMediaQueries(this.doc);
            }
            const mobileStyles = this._mobileStyles;
            // Find small images in original document (cached across retries)
            if (!this._smallImages) {
                this._smallImages = this.findSmallImages(this.doc);
            }
            const smallImages = this._smallImages;
            // Clone document
            const clone = this.doc.cloneNode(true);
            // Flatten shadow DOM content into the clone
            this.flattenShadowRoots(this.doc, clone);
            // Resolve React streaming SSR suspense boundaries
            this.resolveStreamedContent(clone);
            // Apply mobile styles to clone
            this.applyMobileStyles(clone, mobileStyles);
            // Find main content
            let mainContent = null;
            if (options.contentSelector) {
                mainContent = clone.querySelector(options.contentSelector);
                this._log('Using contentSelector:', options.contentSelector, mainContent ? 'found' : 'not found');
            }
            if (!mainContent) {
                mainContent = this.findMainContent(clone);
            }
            if (!mainContent) {
                const fallbackContent = this.resolveContentUrls((0, dom_1.serializeHTML)(this.doc.body));
                const endTime = Date.now();
                return {
                    content: fallbackContent,
                    ...metadata,
                    wordCount: this.countWords(fallbackContent),
                    parseTime: Math.round(endTime - startTime),
                    metaTags: pageMetaTags
                };
            }
            // Standardize footnotes before cleanup (CSS sidenotes use display:none)
            if (options.standardize) {
                (0, footnotes_1.standardizeFootnotes)(mainContent);
            }
            // Remove small images
            if (options.removeSmallImages) {
                this.removeSmallImages(clone, smallImages);
            }
            // Remove hidden elements using computed styles
            if (options.removeHiddenElements) {
                this.removeHiddenElements(clone, debugRemovals);
            }
            // Remove non-content blocks by scoring
            // Tries to find lists, navigation based on text content and link density
            if (options.removeLowScoring) {
                scoring_1.ContentScorer.scoreAndRemove(clone, this.debug, debugRemovals, mainContent);
            }
            // Remove clutter using selectors
            if (options.removeExactSelectors || options.removePartialSelectors) {
                this.removeBySelector(clone, options.removeExactSelectors, options.removePartialSelectors, mainContent, debugRemovals);
            }
            // Remove elements by content patterns (read time, boilerplate, article cards)
            if (options.removeContentPatterns && mainContent) {
                this.removeByContentPattern(mainContent, this.debug ? debugRemovals : undefined);
            }
            // Normalize the main content
            if (options.standardize) {
                (0, standardize_1.standardizeContent)(mainContent, metadata, this.doc, this.debug);
            }
            // Resolve relative URLs to absolute
            this.resolveRelativeUrls(mainContent);
            const content = mainContent.outerHTML;
            const endTime = Date.now();
            const result = {
                content,
                ...metadata,
                wordCount: this.countWords(content),
                parseTime: Math.round(endTime - startTime),
                metaTags: pageMetaTags
            };
            if (this.debug) {
                result.debug = {
                    contentSelector: this.getElementSelector(mainContent),
                    removals: debugRemovals
                };
            }
            return result;
        }
        catch (error) {
            console.error('Defuddle', 'Error processing document:', error);
            const errorContent = this.resolveContentUrls((0, dom_1.serializeHTML)(this.doc.body));
            const endTime = Date.now();
            return {
                content: errorContent,
                ...metadata,
                wordCount: this.countWords(errorContent),
                parseTime: Math.round(endTime - startTime),
                metaTags: pageMetaTags
            };
        }
    }
    countWords(content) {
        // Strip HTML tags and decode common entities without DOM parsing
        const text = content
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#\d+;/g, ' ')
            .replace(/&\w+;/g, ' ');
        const trimmed = text.trim();
        if (!trimmed)
            return 0;
        // Count words by splitting on whitespace
        let count = 0;
        let inWord = false;
        for (let i = 0; i < trimmed.length; i++) {
            const isSpace = trimmed.charCodeAt(i) <= 32;
            if (!isSpace && !inWord) {
                count++;
                inWord = true;
            }
            else if (isSpace) {
                inWord = false;
            }
        }
        return count;
    }
    // Make all other methods private by removing the static keyword and using private
    _log(...args) {
        if (this.debug) {
            console.log('Defuddle:', ...args);
        }
    }
    _evaluateMediaQueries(doc) {
        const mobileStyles = [];
        const maxWidthRegex = /max-width[^:]*:\s*(\d+)/;
        try {
            // Get all styles, including inline styles
            const sheets = Array.from(doc.styleSheets).filter(sheet => {
                try {
                    // Access rules once to check validity
                    sheet.cssRules;
                    return true;
                }
                catch (e) {
                    // Expected error for cross-origin stylesheets or Node.js environment
                    if (e instanceof DOMException && e.name === 'SecurityError') {
                        return false;
                    }
                    return false;
                }
            });
            // Process all sheets in a single pass
            const mediaRules = sheets.flatMap(sheet => {
                try {
                    // Check if we're in a browser environment where CSSMediaRule is available
                    if (typeof CSSMediaRule === 'undefined') {
                        return [];
                    }
                    return Array.from(sheet.cssRules)
                        .filter((rule) => rule instanceof CSSMediaRule &&
                        rule.conditionText.includes('max-width'));
                }
                catch (e) {
                    if (this.debug) {
                        console.warn('Defuddle: Failed to process stylesheet:', e);
                    }
                    return [];
                }
            });
            // Process all media rules in a single pass
            mediaRules.forEach(rule => {
                const match = rule.conditionText.match(maxWidthRegex);
                if (match) {
                    const maxWidth = parseInt(match[1]);
                    if (constants_1.MOBILE_WIDTH <= maxWidth) {
                        // Batch process all style rules
                        const styleRules = Array.from(rule.cssRules)
                            .filter((r) => r instanceof CSSStyleRule);
                        styleRules.forEach(cssRule => {
                            try {
                                mobileStyles.push({
                                    selector: cssRule.selectorText,
                                    styles: cssRule.style.cssText
                                });
                            }
                            catch (e) {
                                if (this.debug) {
                                    console.warn('Defuddle: Failed to process CSS rule:', e);
                                }
                            }
                        });
                    }
                }
            });
        }
        catch (e) {
            console.error('Defuddle: Error evaluating media queries:', e);
        }
        return mobileStyles;
    }
    applyMobileStyles(doc, mobileStyles) {
        let appliedCount = 0;
        mobileStyles.forEach(({ selector, styles }) => {
            try {
                const elements = doc.querySelectorAll(selector);
                elements.forEach(element => {
                    element.setAttribute('style', (element.getAttribute('style') || '') + styles);
                    appliedCount++;
                });
            }
            catch (e) {
                console.error('Defuddle', 'Error applying styles for selector:', selector, e);
            }
        });
    }
    removeImages(doc) {
        const images = doc.getElementsByTagName('img');
        Array.from(images).forEach(image => {
            image.remove();
        });
    }
    removeHiddenElements(doc, debugRemovals) {
        let count = 0;
        const elementsToRemove = new Map();
        // Check inline styles and CSS class-based hidden patterns.
        const hiddenStylePattern = /(?:^|;\s*)(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)(?:\s*;|\s*$)/i;
        // Only use getComputedStyle in browser environments where it's meaningful.
        // In JSDOM/linkedom without stylesheets, it's extremely slow and unreliable.
        const defaultView = doc.defaultView;
        const isBrowser = typeof window !== 'undefined' && defaultView === window;
        const allElements = doc.querySelectorAll('*');
        for (const element of allElements) {
            // Skip elements that contain math — sites like Wikipedia wrap MathML
            // in display:none spans for accessibility (the visible version is an
            // image/SVG fallback). We need to preserve these for math extraction.
            if (element.querySelector('math, [data-mathml], .katex-mathml') ||
                element.tagName.toLowerCase() === 'math') {
                continue;
            }
            // Check inline style for hidden patterns
            const style = element.getAttribute('style');
            if (style && hiddenStylePattern.test(style)) {
                const reason = style.includes('display') ? 'display:none' :
                    style.includes('visibility') ? 'visibility:hidden' : 'opacity:0';
                elementsToRemove.set(element, reason);
                count++;
                continue;
            }
            // Use getComputedStyle only in real browser environments
            if (isBrowser) {
                try {
                    const computedStyle = defaultView.getComputedStyle(element);
                    let reason = '';
                    if (computedStyle.display === 'none')
                        reason = 'display:none';
                    else if (computedStyle.visibility === 'hidden')
                        reason = 'visibility:hidden';
                    else if (computedStyle.opacity === '0')
                        reason = 'opacity:0';
                    if (reason) {
                        elementsToRemove.set(element, reason);
                        count++;
                        continue;
                    }
                }
                catch (e) { }
            }
            // Detect CSS framework hidden utilities (e.g. Tailwind's "hidden",
            // "sm:hidden", "not-machine:hidden")
            const className = element.getAttribute('class') || '';
            if (className) {
                const tokens = className.split(/\s+/);
                for (const token of tokens) {
                    if (token === 'hidden' || token.endsWith(':hidden')) {
                        elementsToRemove.set(element, `class:${token}`);
                        count++;
                        break;
                    }
                }
            }
        }
        // Batch remove all hidden elements
        elementsToRemove.forEach((reason, el) => {
            if (this.debug && debugRemovals) {
                debugRemovals.push({
                    step: 'removeHiddenElements',
                    reason,
                    text: (0, utils_1.textPreview)(el)
                });
            }
            el.remove();
        });
        this._log('Removed hidden elements:', count);
    }
    removeBySelector(doc, removeExact = true, removePartial = true, mainContent, debugRemovals) {
        const startTime = Date.now();
        let exactSelectorCount = 0;
        let partialSelectorCount = 0;
        // Track all elements to be removed, with their match type
        const elementsToRemove = new Map();
        // First collect elements matching exact selectors
        if (removeExact) {
            const exactElements = doc.querySelectorAll(constants_1.EXACT_SELECTORS.join(','));
            exactElements.forEach(el => {
                if (el?.parentNode) {
                    // Skip elements inside code blocks (e.g. syntax highlighting spans)
                    if (el.closest('pre, code')) {
                        return;
                    }
                    elementsToRemove.set(el, { type: 'exact' });
                    exactSelectorCount++;
                }
            });
        }
        if (removePartial) {
            // Pre-compile regexes and combine into a single regex for better performance
            const combinedPattern = constants_1.PARTIAL_SELECTORS.join('|');
            const partialRegex = new RegExp(combinedPattern, 'i');
            // Pre-compile individual regexes for debug pattern identification
            const individualRegexes = this.debug
                ? constants_1.PARTIAL_SELECTORS.map(p => ({ pattern: p, regex: new RegExp(p, 'i') }))
                : null;
            // Create an efficient attribute selector for elements we care about
            const attributeSelector = constants_1.TEST_ATTRIBUTES.map(attr => `[${attr}]`).join(',');
            const allElements = doc.querySelectorAll(attributeSelector);
            // Process elements for partial matches
            allElements.forEach(el => {
                // Skip if already marked for removal
                if (elementsToRemove.has(el)) {
                    return;
                }
                // Skip code elements and elements containing code blocks
                // where class names indicate language/syntax, not page structure
                const tag = el.tagName;
                if (tag === 'CODE' || tag === 'PRE' || el.querySelector('pre')) {
                    return;
                }
                // Get all relevant attributes and combine into a single string
                const attrs = constants_1.TEST_ATTRIBUTES.map(attr => {
                    if (attr === 'class') {
                        return el.className && typeof el.className === 'string' ? el.className : '';
                    }
                    if (attr === 'id') {
                        return el.id || '';
                    }
                    return el.getAttribute(attr) || '';
                }).join(' ').toLowerCase();
                // Skip if no attributes to check
                if (!attrs.trim()) {
                    return;
                }
                // Check for partial match using single regex test
                if (partialRegex.test(attrs)) {
                    const matchedPattern = individualRegexes
                        ? individualRegexes.find(r => r.regex.test(attrs))?.pattern
                        : undefined;
                    elementsToRemove.set(el, { type: 'partial', selector: matchedPattern });
                    partialSelectorCount++;
                }
            });
        }
        // Remove all collected elements in a single pass
        // Skip elements that are ancestors of mainContent to avoid disconnecting it
        // Skip footnote list containers, their parents, and immediate children
        // Skip anchor links inside headings - the heading transform handles these
        elementsToRemove.forEach(({ type, selector }, el) => {
            if (mainContent && el.contains(mainContent)) {
                return;
            }
            if (el.tagName === 'A' && el.closest('h1, h2, h3, h4, h5, h6')) {
                return;
            }
            try {
                if (el.matches(constants_1.FOOTNOTE_LIST_SELECTORS) || el.querySelector(constants_1.FOOTNOTE_LIST_SELECTORS)) {
                    return;
                }
                // Protect immediate children of footnote containers (e.g. wikidot div.footnote-footer)
                const parent = el.parentElement;
                if (parent && parent.matches(constants_1.FOOTNOTE_LIST_SELECTORS)) {
                    return;
                }
            }
            catch (e) { }
            if (this.debug && debugRemovals) {
                debugRemovals.push({
                    step: 'removeBySelector',
                    selector: type === 'exact' ? 'exact' : selector,
                    reason: type === 'exact' ? 'exact selector match' : `partial match: ${selector}`,
                    text: (0, utils_1.textPreview)(el)
                });
            }
            el.remove();
        });
        const endTime = Date.now();
        this._log('Removed clutter elements:', {
            exactSelectors: exactSelectorCount,
            partialSelectors: partialSelectorCount,
            total: elementsToRemove.size,
            processingTime: `${(endTime - startTime).toFixed(2)}ms`
        });
    }
    // Find small IMG and SVG elements
    findSmallImages(doc) {
        const MIN_DIMENSION = 33;
        const smallImages = new Set();
        let processedCount = 0;
        const elements = doc.querySelectorAll('img, svg');
        const defaultView = doc.defaultView;
        const isBrowser = typeof window !== 'undefined' && defaultView === window;
        for (const element of elements) {
            const attrWidth = parseInt(element.getAttribute('width') || '0');
            const attrHeight = parseInt(element.getAttribute('height') || '0');
            // Check inline style dimensions
            const style = element.getAttribute('style') || '';
            const styleWidth = parseInt(style.match(/width\s*:\s*(\d+)/)?.[1] || '0');
            const styleHeight = parseInt(style.match(/height\s*:\s*(\d+)/)?.[1] || '0');
            // Use getComputedStyle and getBoundingClientRect only in browser
            let computedWidth = 0, computedHeight = 0;
            if (isBrowser) {
                try {
                    const cs = defaultView.getComputedStyle(element);
                    computedWidth = parseInt(cs.width) || 0;
                    computedHeight = parseInt(cs.height) || 0;
                }
                catch (e) { }
                try {
                    const rect = element.getBoundingClientRect();
                    if (rect.width > 0)
                        computedWidth = computedWidth || rect.width;
                    if (rect.height > 0)
                        computedHeight = computedHeight || rect.height;
                }
                catch (e) { }
            }
            const widths = [attrWidth, styleWidth, computedWidth].filter(d => d > 0);
            const heights = [attrHeight, styleHeight, computedHeight].filter(d => d > 0);
            if (widths.length > 0 && heights.length > 0) {
                const effectiveWidth = Math.min(...widths);
                const effectiveHeight = Math.min(...heights);
                if (effectiveWidth < MIN_DIMENSION || effectiveHeight < MIN_DIMENSION) {
                    const identifier = this.getElementIdentifier(element);
                    if (identifier) {
                        smallImages.add(identifier);
                        processedCount++;
                    }
                }
            }
        }
        this._log('Found small elements:', processedCount);
        return smallImages;
    }
    removeSmallImages(doc, smallImages) {
        let removedCount = 0;
        ['img', 'svg'].forEach(tag => {
            const elements = doc.getElementsByTagName(tag);
            Array.from(elements).forEach(element => {
                const identifier = this.getElementIdentifier(element);
                if (identifier && smallImages.has(identifier)) {
                    element.remove();
                    removedCount++;
                }
            });
        });
        this._log('Removed small elements:', removedCount);
    }
    getElementIdentifier(element) {
        // Try to create a unique identifier using various attributes
        if (element.tagName.toLowerCase() === 'img') {
            // For lazy-loaded images, use data-src as identifier if available
            const dataSrc = element.getAttribute('data-src');
            if (dataSrc)
                return `src:${dataSrc}`;
            const src = element.getAttribute('src') || '';
            const srcset = element.getAttribute('srcset') || '';
            const dataSrcset = element.getAttribute('data-srcset');
            if (src)
                return `src:${src}`;
            if (srcset)
                return `srcset:${srcset}`;
            if (dataSrcset)
                return `srcset:${dataSrcset}`;
        }
        const id = element.id || '';
        const className = element.className || '';
        const viewBox = element.tagName.toLowerCase() === 'svg' ? element.getAttribute('viewBox') || '' : '';
        if (id)
            return `id:${id}`;
        if (viewBox)
            return `viewBox:${viewBox}`;
        if (className)
            return `class:${className}`;
        return null;
    }
    findMainContent(doc) {
        // Find all potential content containers
        const candidates = [];
        constants_1.ENTRY_POINT_ELEMENTS.forEach((selector, index) => {
            const elements = doc.querySelectorAll(selector);
            elements.forEach(element => {
                // Base score from selector priority (earlier = higher)
                let score = (constants_1.ENTRY_POINT_ELEMENTS.length - index) * 40;
                // Add score based on content analysis
                score += scoring_1.ContentScorer.scoreElement(element);
                candidates.push({ element, score, selectorIndex: index });
            });
        });
        if (candidates.length === 0) {
            // Fall back to scoring block elements
            return this.findContentByScoring(doc);
        }
        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);
        if (this.debug) {
            this._log('Content candidates:', candidates.map(c => ({
                element: c.element.tagName,
                selector: this.getElementSelector(c.element),
                score: c.score
            })));
        }
        // If we only matched body, try table-based detection
        if (candidates.length === 1 && candidates[0].element.tagName.toLowerCase() === 'body') {
            const tableContent = this.findTableBasedContent(doc);
            if (tableContent) {
                return tableContent;
            }
        }
        // If the top candidate contains a child candidate that matched a
        // higher-priority selector, prefer the most specific (deepest) child.
        // This prevents e.g. <main> from winning over a contained <article>
        // just because sibling noise inflates the parent's content score.
        // Only prefer the child if it has meaningful content (>50 words),
        // otherwise it may be an empty card element (e.g. related article cards).
        // Skip this when the parent contains multiple children matching the
        // same selector — that indicates a listing/portfolio page where the
        // parent is the real content container.
        const top = candidates[0];
        let best = top;
        for (let i = 1; i < candidates.length; i++) {
            const child = candidates[i];
            const childWords = (child.element.textContent || '').split(/\s+/).length;
            if (child.selectorIndex < best.selectorIndex && best.element.contains(child.element) && childWords > 50) {
                // Count how many candidates share this selector index inside
                // the top element. Use top (not best) as the stable reference
                // so the check isn't affected by earlier iterations.
                let siblingsAtIndex = 0;
                for (const c of candidates) {
                    if (c.selectorIndex === child.selectorIndex && top.element.contains(c.element)) {
                        if (++siblingsAtIndex > 1)
                            break;
                    }
                }
                if (siblingsAtIndex > 1) {
                    // Multiple articles/cards inside the parent — it's a listing page
                    continue;
                }
                best = child;
            }
        }
        if (best !== top) {
            return best.element;
        }
        return top.element;
    }
    findTableBasedContent(doc) {
        // First check if this looks like an old-style table-based layout
        const tables = Array.from(doc.getElementsByTagName('table'));
        const hasTableLayout = tables.some(table => {
            const width = parseInt(table.getAttribute('width') || '0');
            const style = this.getComputedStyle(table);
            return width > 400 ||
                (style?.width?.includes('px') && parseInt(style.width) > 400) ||
                table.getAttribute('align') === 'center' ||
                (table.className || '').toLowerCase().includes('content') ||
                (table.className || '').toLowerCase().includes('article');
        });
        if (!hasTableLayout) {
            return null; // Don't try table-based extraction for modern layouts
        }
        const cells = Array.from(doc.getElementsByTagName('td'));
        return scoring_1.ContentScorer.findBestElement(cells);
    }
    findContentByScoring(doc) {
        const candidates = [];
        doc.querySelectorAll(constants_1.BLOCK_ELEMENTS_SELECTOR).forEach((element) => {
            const score = scoring_1.ContentScorer.scoreElement(element);
            if (score > 0) {
                candidates.push({ score, element });
            }
        });
        return candidates.length > 0 ? candidates.sort((a, b) => b.score - a.score)[0].element : null;
    }
    getElementSelector(element) {
        const parts = [];
        let current = element;
        while (current && current !== this.doc.documentElement) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                selector += '#' + current.id;
            }
            else if (current.className && typeof current.className === 'string') {
                selector += '.' + current.className.trim().split(/\s+/).join('.');
            }
            parts.unshift(selector);
            current = current.parentElement;
        }
        return parts.join(' > ');
    }
    getComputedStyle(element) {
        return (0, utils_1.getComputedStyle)(element);
    }
    /**
     * Resolve relative URLs to absolute within a DOM element
     */
    resolveRelativeUrls(element) {
        const baseUrl = this.options.url || this.doc.URL;
        if (!baseUrl)
            return;
        const resolve = (url) => {
            try {
                return new URL(url, baseUrl).href;
            }
            catch {
                return url;
            }
        };
        element.querySelectorAll('[href]').forEach(el => {
            const href = el.getAttribute('href');
            if (href)
                el.setAttribute('href', resolve(href));
        });
        element.querySelectorAll('[src]').forEach(el => {
            const src = el.getAttribute('src');
            if (src)
                el.setAttribute('src', resolve(src));
        });
        element.querySelectorAll('[srcset]').forEach(el => {
            const srcset = el.getAttribute('srcset');
            if (srcset) {
                // Parse srcset using width/density descriptors as delimiters,
                // not commas — URLs may contain commas (e.g. CDN transform params)
                const entryPattern = /(.+?)\s+(\d+(?:\.\d+)?[wx])/g;
                const entries = [];
                let match;
                let lastIdx = 0;
                while ((match = entryPattern.exec(srcset)) !== null) {
                    let url = match[1].trim();
                    if (lastIdx > 0) {
                        url = url.replace(/^,\s*/, '');
                    }
                    lastIdx = entryPattern.lastIndex;
                    entries.push(`${resolve(url)} ${match[2]}`);
                }
                if (entries.length > 0) {
                    el.setAttribute('srcset', entries.join(', '));
                }
                else {
                    // Fallback: simple comma split for srcsets without descriptors
                    const resolved = srcset.split(',').map(entry => {
                        const parts = entry.trim().split(/\s+/);
                        if (parts[0])
                            parts[0] = resolve(parts[0]);
                        return parts.join(' ');
                    }).join(', ');
                    el.setAttribute('srcset', resolved);
                }
            }
        });
        element.querySelectorAll('[poster]').forEach(el => {
            const poster = el.getAttribute('poster');
            if (poster)
                el.setAttribute('poster', resolve(poster));
        });
    }
    /**
     * Flatten shadow DOM content into a cloned document.
     * Walks both trees in parallel so positional correspondence is exact.
     */
    flattenShadowRoots(original, clone) {
        const origElements = Array.from(original.body.querySelectorAll('*'));
        // Find the first element with a shadow root (also serves as the hasShadowRoots check)
        const firstShadow = origElements.find(el => el.shadowRoot);
        if (!firstShadow)
            return;
        const cloneElements = Array.from(clone.body.querySelectorAll('*'));
        // Check if we can directly read shadow DOM content (main world / Node.js).
        // In content script isolated worlds, shadowRoot exists but content is empty.
        const canReadShadow = (firstShadow.shadowRoot?.childNodes?.length ?? 0) > 0;
        if (canReadShadow) {
            // Direct traversal works (main world / Node.js)
            for (let i = origElements.length - 1; i >= 0; i--) {
                const origEl = origElements[i];
                if (!origEl.shadowRoot)
                    continue;
                const cloneEl = cloneElements[i];
                if (!cloneEl)
                    continue;
                const shadowHtml = origEl.shadowRoot.innerHTML;
                if (shadowHtml.length > 0) {
                    this.replaceShadowHost(cloneEl, shadowHtml, clone);
                }
            }
        }
        else {
            // Content script isolated world — read data-defuddle-shadow attributes
            // stamped by an external main-world script.
            const shadowData = [];
            for (let i = 0; i < origElements.length; i++) {
                const origEl = origElements[i];
                const shadowHtml = origEl.getAttribute('data-defuddle-shadow');
                if (!shadowHtml)
                    continue;
                const cloneEl = cloneElements[i];
                if (!cloneEl)
                    continue;
                shadowData.push({ cloneEl, html: shadowHtml });
                // Clean up temporary attributes from both original and clone
                origEl.removeAttribute('data-defuddle-shadow');
                cloneEl.removeAttribute('data-defuddle-shadow');
            }
            for (const { cloneEl, html } of shadowData) {
                this.replaceShadowHost(cloneEl, html, clone);
            }
        }
    }
    /**
     * Resolve React streaming SSR suspense boundaries.
     * React's streaming SSR places content in hidden divs (id="S:0") and
     * template placeholders (id="B:0") with $RC scripts to swap them.
     * Since we don't execute scripts, we perform the swap manually.
     */
    resolveStreamedContent(doc) {
        // Find $RC("B:X","S:X") calls in inline scripts
        const scripts = doc.querySelectorAll('script');
        const swaps = [];
        const rcPattern = /\$RC\("(B:\d+)","(S:\d+)"\)/g;
        for (const script of scripts) {
            const text = script.textContent || '';
            if (!text.includes('$RC('))
                continue;
            rcPattern.lastIndex = 0;
            let match;
            while ((match = rcPattern.exec(text)) !== null) {
                swaps.push({ templateId: match[1], contentId: match[2] });
            }
        }
        if (swaps.length === 0)
            return;
        let swapCount = 0;
        for (const { templateId, contentId } of swaps) {
            const template = doc.getElementById(templateId);
            const content = doc.getElementById(contentId);
            if (!template || !content)
                continue;
            const parent = template.parentNode;
            if (!parent)
                continue;
            // Remove the fallback/skeleton content after the template
            // until the <!--/$--> comment marker
            let next = template.nextSibling;
            let foundMarker = false;
            while (next) {
                const following = next.nextSibling;
                if (next.nodeType === 8 && next.data === '/$') {
                    next.remove();
                    foundMarker = true;
                    break;
                }
                next.remove();
                next = following;
            }
            // Skip swap if marker wasn't found — malformed streaming output
            if (!foundMarker)
                continue;
            // Insert content children before the template position
            while (content.firstChild) {
                parent.insertBefore(content.firstChild, template);
            }
            // Clean up the template and hidden div
            template.remove();
            content.remove();
            swapCount++;
        }
        if (swapCount > 0) {
            this._log('Resolved streamed content:', swapCount, 'suspense boundaries');
        }
    }
    /**
     * Replace a shadow DOM host element with a div containing its shadow content.
     * Custom elements (tag names with hyphens) would re-initialize when inserted
     * into a live DOM, recreating their shadow roots and hiding the content.
     */
    replaceShadowHost(el, shadowHtml, doc) {
        const fragment = (0, dom_1.parseHTML)(doc, shadowHtml);
        if (el.tagName.includes('-')) {
            // Custom element — replace with a div to prevent re-initialization
            const div = doc.createElement('div');
            div.appendChild(fragment);
            el.parentNode?.replaceChild(div, el);
        }
        else {
            el.textContent = '';
            el.appendChild(fragment);
        }
    }
    /**
     * Resolve relative URLs in an HTML string
     */
    resolveContentUrls(html) {
        const baseUrl = this.options.url || this.doc.URL;
        if (!baseUrl)
            return html;
        const container = this.doc.createElement('div');
        container.appendChild((0, dom_1.parseHTML)(this.doc, html));
        this.resolveRelativeUrls(container);
        return (0, dom_1.serializeHTML)(container);
    }
    _extractSchemaOrgData(doc) {
        const schemaScripts = doc.querySelectorAll('script[type="application/ld+json"]');
        const rawSchemaItems = [];
        schemaScripts.forEach(script => {
            let jsonContent = script.textContent || '';
            try {
                jsonContent = jsonContent
                    .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
                    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
                    .replace(/^\s*(\*\/|\/\*)\s*|\s*(\*\/|\/\*)\s*$/g, '')
                    .trim();
                const jsonData = JSON.parse(jsonContent);
                if (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) {
                    rawSchemaItems.push(...jsonData['@graph']);
                }
                else {
                    rawSchemaItems.push(jsonData);
                }
            }
            catch (error) {
                console.error('Defuddle: Error parsing schema.org data:', error);
                if (this.debug) {
                    console.error('Defuddle: Problematic JSON content:', jsonContent);
                }
            }
        });
        const decodeStringsInObject = (item) => {
            if (typeof item === 'string') {
                return this._decodeHTMLEntities(item);
            }
            else if (Array.isArray(item)) {
                return item.map(decodeStringsInObject);
            }
            else if (typeof item === 'object' && item !== null) {
                const newItem = {};
                for (const key in item) {
                    if (Object.prototype.hasOwnProperty.call(item, key)) {
                        newItem[key] = decodeStringsInObject(item[key]);
                    }
                }
                return newItem;
            }
            return item;
        };
        return rawSchemaItems.map(decodeStringsInObject);
    }
    _collectMetaTags() {
        const pageMetaTags = [];
        this.doc.querySelectorAll('meta').forEach(meta => {
            const name = meta.getAttribute('name');
            const property = meta.getAttribute('property');
            let content = meta.getAttribute('content');
            if (content) {
                pageMetaTags.push({ name, property, content: this._decodeHTMLEntities(content) });
            }
        });
        return pageMetaTags;
    }
    _decodeHTMLEntities(text) {
        return (0, dom_1.decodeHTMLEntities)(this.doc, text);
    }
    /**
     * Build a DefuddleResponse from an extractor result with metadata
     */
    buildExtractorResponse(extracted, metadata, startTime, extractor, pageMetaTags) {
        const contentHtml = this.resolveContentUrls(extracted.contentHtml);
        const variables = this.getExtractorVariables(extracted.variables);
        return {
            content: contentHtml,
            title: extracted.variables?.title || metadata.title,
            description: metadata.description,
            domain: metadata.domain,
            favicon: metadata.favicon,
            image: metadata.image,
            language: extracted.variables?.language || metadata.language,
            published: extracted.variables?.published || metadata.published,
            author: extracted.variables?.author || metadata.author,
            site: extracted.variables?.site || metadata.site,
            schemaOrgData: metadata.schemaOrgData,
            wordCount: this.countWords(extracted.contentHtml),
            parseTime: Math.round(Date.now() - startTime),
            extractorType: extractor.constructor.name.replace('Extractor', '').toLowerCase(),
            metaTags: pageMetaTags,
            ...(variables ? { variables } : {}),
        };
    }
    /**
     * Filter extractor variables to only include custom ones
     * (exclude standard fields that are already mapped to top-level properties)
     */
    getExtractorVariables(variables) {
        if (!variables)
            return undefined;
        const custom = {};
        let hasCustom = false;
        for (const [key, value] of Object.entries(variables)) {
            if (!STANDARD_VARIABLE_KEYS.has(key)) {
                custom[key] = value;
                hasCustom = true;
            }
        }
        return hasCustom ? custom : undefined;
    }
    /**
     * Content-based pattern removal for elements that can't be detected by
     * CSS selectors (e.g. Tailwind/CSS-in-JS sites with non-semantic class names).
     */
    removeByContentPattern(mainContent, debugRemovals) {
        // Remove read time metadata (e.g. "Mar 4th 2026 | 3 min read")
        // Only removes leaf elements whose text is PURELY date + read time,
        // not mixed with other meaningful content like tag names.
        const candidates = Array.from(mainContent.querySelectorAll('p, span, div, time'));
        for (const el of candidates) {
            if (!el.parentNode)
                continue;
            if (el.closest('pre') || el.closest('code'))
                continue;
            const text = el.textContent?.trim() || '';
            const words = text.split(/\s+/).length;
            // Match date + read time in short elements
            if (words <= 15 && CONTENT_DATE_PATTERN.test(text) && CONTENT_READ_TIME_PATTERN.test(text)) {
                // Ensure this is a leaf-ish element, not a large container
                if (el.querySelectorAll('p, div, section, article').length === 0) {
                    // Verify the text is ONLY date + read time metadata
                    // by stripping all date/time words and checking nothing remains
                    let cleaned = text;
                    for (const pattern of METADATA_STRIP_PATTERNS) {
                        cleaned = cleaned.replace(pattern, '');
                    }
                    if (cleaned.trim().length > 0)
                        continue;
                    if (this.debug && debugRemovals) {
                        debugRemovals.push({
                            step: 'removeByContentPattern',
                            reason: 'read time metadata',
                            text: (0, utils_1.textPreview)(el)
                        });
                    }
                    el.remove();
                }
            }
        }
        // Remove standalone time/date elements near the start or end of content.
        // A <time> in its own paragraph at the boundary is metadata (publish date),
        // but <time> inline within prose should be preserved (see issue #136).
        const timeElements = Array.from(mainContent.querySelectorAll('time'));
        const contentText = mainContent.textContent || '';
        for (const time of timeElements) {
            if (!time.parentNode)
                continue;
            // Walk up through inline/formatting wrappers only (i, em, span, b, strong)
            // Stop at block elements to avoid removing containers with other content.
            let target = time;
            let targetText = target.textContent?.trim() || '';
            while (target.parentElement && target.parentElement !== mainContent) {
                const parentTag = target.parentElement.tagName.toLowerCase();
                const parentText = target.parentElement.textContent?.trim() || '';
                // If parent is a <p> that only wraps this time, include it
                if (parentTag === 'p' && parentText === targetText) {
                    target = target.parentElement;
                    break;
                }
                // Only walk through inline formatting wrappers
                if (['i', 'em', 'span', 'b', 'strong', 'small'].includes(parentTag) &&
                    parentText === targetText) {
                    target = target.parentElement;
                    targetText = parentText;
                    continue;
                }
                break;
            }
            const text = target.textContent?.trim() || '';
            const words = text.split(/\s+/).length;
            if (words > 10)
                continue;
            // Check if this element is near the start or end of mainContent
            const pos = contentText.indexOf(text);
            const distFromEnd = contentText.length - (pos + text.length);
            if (pos > 200 && distFromEnd > 200)
                continue;
            if (this.debug && debugRemovals) {
                debugRemovals.push({
                    step: 'removeByContentPattern',
                    reason: 'boundary date element',
                    text: (0, utils_1.textPreview)(target)
                });
            }
            target.remove();
        }
        // Remove section breadcrumbs
        // Short elements containing a link to a parent section of the current URL.
        const url = this.options.url || this.doc.URL || '';
        let urlPath = '';
        try {
            urlPath = new URL(url).pathname;
        }
        catch { }
        if (urlPath) {
            const shortElements = mainContent.querySelectorAll('div, span, p');
            for (const el of shortElements) {
                if (!el.parentNode)
                    continue;
                const text = el.textContent?.trim() || '';
                const words = text.split(/\s+/).length;
                if (words > 10)
                    continue;
                // Must be a leaf-ish element (no block children)
                if (el.querySelectorAll('p, div, section, article').length > 0)
                    continue;
                const link = el.querySelector('a[href]');
                if (!link)
                    continue;
                try {
                    const linkPath = new URL(link.getAttribute('href') || '', url).pathname;
                    if (linkPath !== '/' && linkPath !== urlPath && urlPath.startsWith(linkPath)) {
                        if (this.debug && debugRemovals) {
                            debugRemovals.push({
                                step: 'removeByContentPattern',
                                reason: 'section breadcrumb',
                                text: (0, utils_1.textPreview)(el)
                            });
                        }
                        el.remove();
                    }
                }
                catch { }
            }
        }
        // Remove boilerplate sentences and trailing non-content.
        // Search elements for end-of-article boilerplate, then truncate
        // from the best ancestor that has siblings to remove.
        const fullText = mainContent.textContent || '';
        const boilerplateElements = mainContent.querySelectorAll('p, div, span, section');
        for (const el of boilerplateElements) {
            if (!el.parentNode)
                continue;
            const text = el.textContent?.trim() || '';
            const words = text.split(/\s+/).length;
            if (words > 50 || words < 3)
                continue;
            for (const pattern of BOILERPLATE_PATTERNS) {
                if (pattern.test(text)) {
                    // Walk up to find an ancestor that has next siblings to truncate.
                    // Don't walk all the way to mainContent's direct child — if there's
                    // a single wrapper div, that would remove everything.
                    let target = el;
                    while (target.parentElement && target.parentElement !== mainContent) {
                        if (target.nextElementSibling)
                            break;
                        target = target.parentElement;
                    }
                    // Only truncate if there's substantial content before the boilerplate
                    const targetText = target.textContent || '';
                    const targetPos = fullText.indexOf(targetText);
                    if (targetPos < 200)
                        continue;
                    // Collect ancestors before modifying the DOM
                    const ancestors = [];
                    let anc = target.parentElement;
                    while (anc && anc !== mainContent) {
                        ancestors.push(anc);
                        anc = anc.parentElement;
                    }
                    // Remove target element and its following siblings
                    this.removeTrailingSiblings(target, true, debugRemovals);
                    // Cascade upward: remove following siblings at each
                    // ancestor level too. Everything after the boilerplate
                    // in document order is non-content.
                    for (const ancestor of ancestors) {
                        this.removeTrailingSiblings(ancestor, false, debugRemovals);
                    }
                    return;
                }
            }
        }
    }
    /**
     * Remove an element's following siblings, and optionally the element itself.
     */
    removeTrailingSiblings(element, removeSelf, debugRemovals) {
        let sibling = element.nextElementSibling;
        while (sibling) {
            const next = sibling.nextElementSibling;
            if (this.debug && debugRemovals) {
                debugRemovals.push({
                    step: 'removeByContentPattern',
                    reason: 'trailing non-content',
                    text: (0, utils_1.textPreview)(sibling)
                });
            }
            sibling.remove();
            sibling = next;
        }
        if (removeSelf) {
            if (this.debug && debugRemovals) {
                debugRemovals.push({
                    step: 'removeByContentPattern',
                    reason: 'boilerplate text',
                    text: (0, utils_1.textPreview)(element)
                });
            }
            element.remove();
        }
    }
}
exports.Defuddle = Defuddle;
//# sourceMappingURL=defuddle.js.map