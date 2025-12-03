import MiniSearch from "minisearch";
import { parseEpub } from '@gxl/epub-parser';
import fs from "fs/promises";
import path from "path";
import * as cheerio from 'cheerio';


function resolveHome(filepath) {
    if (filepath[0] === '~') {
        return path.join(process.env.HOME, filepath.slice(1));
    }
    return filepath;
};

/**
 * @typedef Chapter 
 * @type {object}
 * @property {string} id
 * @property {string} book_id
 * @property {string} title - the title of the story the chapter belongs to
 * @property {number} chapter - the ao3 chapter number
 * @property {string} chapter_title
 * @property {string} author
 * @property {string} url
 * @property {string} chapter_text
 * @property {string} chapter_notes
 */


const SEARCHINDEX_PATH = process.env.PLOOGLE_DOCKER ? './index/searchindex.json' : './searchindex.json'
const FEELINGLUCKY_PATH = process.env.PLOOGLE_DOCKER ? './index/urls.json' : './urls.json'
const BLACKLIST = process.env.PLOOGLE_DOCKER ? './index/blacklist.json' : './blacklist.json'


const loadDocuments = async (baseDir) => {

    baseDir = resolveHome(baseDir)

    try {
        // ls files 
        let files = await fs.readdir(baseDir);
        //for each file in files parse epub
        const epubObjs = await Promise.all(files.map(async (file) => {
            return parseEpub(path.join(baseDir, file));
        }));
        //for each epub object extract chapters 
        const chapters = epubObjs.map((book) => {

            const title = book.info.title._
            const author = book.info.author

            const description = book._metadata[0]["dc:description"] ? book._metadata[0]["dc:description"][0] : null
            const book_id = book._metadata[0]["dc:identifier"][0]._
            const book_url = book._metadata[0]["dc:source"][0]
            SearchInstance.addUrl(book_url);

            let chapters = book.sections?.map((section, index) => {
                const $ = cheerio.load(section.htmlString);

                let chapter = {
                    id: book_id + '/' + section.id,
                    book_id,
                    title: title,
                    chapter: index,
                    chapter_title: "Summary",
                    author: author,
                    url: book_url,
                    chapter_text: section.toMarkdown(),
                    chapter_notes: description || $("div.fff_chapter_notes").text() || ""
                }

                $("meta").each((i, elem) => {
                    const name = $(elem).attr('name')
                    if (name == "chapterurl") {
                        let content = $(elem).attr('content')
                        if (content) {
                            chapter["url"] = content;
                        }
                    } else if (name == "chapterorigtitle") {
                        let content = $(elem).attr('content')
                        chapter["chapter_title"] = content;
                    }
                });
                return chapter
            })
            return chapters;
        }).flat();
        return chapters;
    } catch (err) {
        console.error(err);
        process.exit(-1);
    }
};


const options = {
    storeFields: ['title', 'author', 'url', 'chapter', 'chapter_title', 'chapter_notes', 'book_id', 'chapter_text'],
    fields: ['id', 'book_id', 'title', 'chapter', 'chapter_title', 'author', 'url', 'chapter_text', 'chapter_notes'],
    idField: ['id'],
    boost: {
        title: 20,
    }
}

/**
 * 
 * @param {*} query 
 * @returns string[]
 */
const parseQuery = (query) => {
    subQueries = query.split('"').filter(v => !!v).map((v) => v.trim());
    console.log(subQueries)
    return subQueries
}

const PAGE_SIZE = process.env.PLOOGLE_PAGE_SIZE || 20;

/**
 * @typedef QueryParams
 * @@type {object} 
 * @property {number} page
 * @property {string} operator
 * @property {string} domain
 * @property {number} fuzzy
 */


class SearchInstance {
    /**
     * MiniSearch
     */
    static _instance;
    static _ready = false;
    static _url_list = new Set();

    static isReady() { return this._ready };

    static getInstance() {

        if (this._instance != null) {
            return this._instance
        }
        this._instance = this.initSearch()
        return this._instance
    }

    static addUrl(url) {
        this._url_list.add(url)
    }

    static async loadIndex() {
        process.stdout.write("Loading Index...")
        const jsindex = await fs.readFile(SEARCHINDEX_PATH)
        this._instance = MiniSearch.loadJSON(jsindex, options)
        this._ready = true
        process.stdout.write(" Done!\n")

        process.stdout.write("Loading url list...")
        const bufUrls = await fs.readFile(FEELINGLUCKY_PATH)
        const arrUrls = JSON.parse(bufUrls)
        this._url_list = new Set(arrUrls);
        process.stdout.write(" Done!\n")
    }

    static async createIndex() {

        let baseDir = process.env.PLOOGLE_DOCDIR || './books'

        process.stdout.write(`recreating index: loading documents from ${baseDir}...`)
        let docs = await loadDocuments(baseDir)
        process.stdout.write(` Done! Loaded ${docs.length} chapters\n`)

        process.stdout.write("creating MiniSearch index...")
        this._instance = new MiniSearch(options)
        await this._instance.addAllAsync(docs)
        this._ready = true;
        process.stdout.write(" Done!\n")

    }

    static async saveIndex() {
        process.stdout.write("saving searchindex.json...")
        const json = JSON.stringify(this._instance)
        await fs.writeFile(SEARCHINDEX_PATH, json)
        process.stdout.write(" Done!\n")

        process.stdout.write("saving urls.json...")
        const jsonUrls = JSON.stringify(Array.from(this._url_list))
        await fs.writeFile(FEELINGLUCKY_PATH, jsonUrls)
        process.stdout.write(" Done!\n")
    }

    static async initSearch() {
        let createIndex = !!(process.env.PLOOGLE_CREATE_INDEX)
        if (createIndex) {
            await this.createIndex();
            if (!process.env.PLOOGLE_DEV) {
                await this.saveIndex();
            }
        } else {
            await this.loadIndex();
        }
    }

    /**
     * 
     * @param {string} query 
     * @param {QueryParams} params 
     * @returns 
     */
    static search(query, params) {
        // if (!this.isReady()) {
        //     return {
        //         data: null,
        //         error: "search is not ready"
        //     }
        // }


        const startTime = performance.now()

        let searchOptions = {
            combineWith: params.operator,
            fuzzy: false,
        }


        if (params.domain != null) {
            searchOptions.filter = (result) => result.url.startsWith(`https://${params.domain}`)
        }

        const hits = this._instance.search(query, searchOptions);

        // chapters groupby story, return chapter of story with highest score
        const filteredHits = hits.reduce(
            (acc, val) => {
                if (acc[val.book_id]) return acc
                acc[val.book_id] = val;

                return acc;
            },
            {}
        )
        let results = Object.values(filteredHits)


        const subQueries = parseQuery(query);


        if (params.matchAll) {
            const matchAllPattern = new RegExp(`${query}`, 'g')
            results = results.filter((hit, index) => {
                //if (index > 20) return false
                const tm = hit.title.match(matchAllPattern)
                const ctm = hit.chapter_title.match(matchAllPattern)
                const cnm = hit.chapter_notes.match(matchAllPattern)
                const cm = hit.author.match(matchAllPattern)
                const ctxtm = hit.chapter_text.match(matchAllPattern)

                if (hit.title.match(matchAllPattern)) return true
                if (hit.chapter_title.match(matchAllPattern)) return true
                if (hit.chapter_notes.match(matchAllPattern)) return true
                if (hit.author.match(matchAllPattern)) return true
                if (hit.chapter_text.match(matchAllPattern)) return true

                return false

            })
        }


        results.forEach((res) => {
            delete res.chapter_text
        })

        const count = results.length

        if (params["random"]) {
            const selection = results[Math.floor(Math.random() * results.length)]
            if (selection) { return selection.url }
            return

        }
        // pagination
        const limit = PAGE_SIZE;
        const pages = Math.ceil(results.length / limit);
        let page = Math.floor(Math.max(params.page, 1)) - 1 // lie about being on the 0th page because users 
        // cap off page to not allow empty
        if (page > pages) {
            page = pages
        }

        const offset = page * PAGE_SIZE;
        const data = results.slice(offset, offset + limit)

        const endTime = performance.now()
        const queryTime = ((endTime - startTime)).toPrecision(4)

        return {
            data,
            info: {
                count,
                page: {
                    page: page + 1,
                    pages,
                    limit,
                    offset
                },
                perf: queryTime,
                params, query
            },
            error: null
        };
    }

    static random(query) {
        if (query) {
            let url = this.search(query, { operator: "OR", random: true })
            if (url) return url
        }
        const url = Array.from(this._url_list)[Math.floor(Math.random() * this._url_list.size)];
        return url


    }

    static async addDocuments(docs) {
        docs.map((doc) => {
            if (this._instance.has(doc.id)) { this._instance.discard(doc.id) }
            this._url_list.add(doc.url)
        })
        await this._instance.addAll(docs)
        //this.saveIndex()
    }
}


export default SearchInstance