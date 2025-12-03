import nodeCron from "node-cron";
import * as child_process from "child_process";
import SearchInstance from "./SearchIndex.js";
import fs from "fs/promises";
import path from "path";
import { parseEpub } from '@gxl/epub-parser';
import * as cheerio from "cheerio";
import util from 'util';

let healIndexTask = null;


export async function healIndex() {

    console.log("running scheduled index update job...")
    const lastbook = (await getBooksByModified())[0];
    await fetchBooks(1, lastbook.book)
    console.log("update job done!")
}


export async function schedCrawl() {

    healIndexTask = nodeCron.schedule("32 22 * * *", healIndex, {
        noOverlap: true,
        timezone: "Europe/Berlin",
    })
    console.log("Scheduled search index update task!")
}



const addBookToIndex = async (filepath) => {
    try {

        const book = await parseEpub(filepath)

        const title = book.info.title._
        const author = book.info.author

        const description = book._metadata[0]["dc:description"] ? book._metadata[0]["dc:description"][0] : null
        const chapters = book.sections?.map((section, index) => {


            const $ = cheerio.load(section.htmlString);

            const book_id = book._metadata[0]["dc:identifier"][0]._
            const book_url = book._metadata[0]["dc:source"][0]

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

        SearchInstance.addDocuments(chapters)


    } catch (err) {
        console.error(err);
        process.exit(-1);
    }

};




const getBooksByModified = async () => {
    const BOOKSHELF = process.env.PLOOGLE_DEV ? './test/books' : './books' //docker volume mount point for bookshelf  
    let files = await fs.readdir(BOOKSHELF);

    const filesByModifiedTime = (await Promise.all(files.map(async file => {
        const bookpath = path.join(BOOKSHELF, file)
        const book = await getBookData(bookpath);
        return { bookpath, stats: await fs.stat(bookpath), book }
    }))).sort((a, b) => {
        const delta = Date.parse(b.book.book_last_update) - Date.parse(a.book.book_last_update)
        return delta
    });

    return filesByModifiedTime
}



const getBookData = async (bookpath) => {

    const book = await parseEpub(bookpath);
    const title = book.info.title._
    const author = book.info.author
    const book_id = book._metadata[0]["dc:identifier"][0]._
    const book_url = book._metadata[0]["dc:source"][0]
    const description = book._metadata[0]["dc:description"] ? book._metadata[0]["dc:description"][0] : null

    const book_last_update = book._metadata[0]["dc:date"][2]._

    return { title, author, book_url, book_last_update };
}



const exec = util.promisify(child_process.exec);

const updateBookTask = async (url) => {

    const fanficfare = process.env.PLOOGLE_DOCKER ? "/root/.local/share/pipx/venvs/fanficfare/bin/fanficfare" : "fanficfare";

    const command = `${fanficfare} -p -d --non-interactive --force https://archiveofourown.org${url}`
    console.log("updating with ", command)

    let pattern = new RegExp('Successfully wrote \'(.*)\'')
    let filename = null
    try {
        const { stdout, stderr } = await exec(command, { cwd: './books' })

        stderr.split("\n").map(line => {
            if (line.includes("Successfully")) {
                filename = line.match(pattern)[1];
            }
        })
        console.log(`Updating ${filename}`)

        if (filename == null) {
            console.error("ERROR:", url, " filenamme null!")
            return
        }
        await addBookToIndex(path.join('./books', filename));
    } catch (e) {
        console.error(e)
    }
}


const fetchBooks = async (pageNr, lastbook) => {
    console.log("Checking for new/updated books");
    const currentUrl = `https://archiveofourown.org/tags/Human%20Domestication%20Guide%20-%20GlitchyRobo/works?page=${pageNr}`
    const res = await fetch(currentUrl)
    let dirtyBooks = [];
    let pageClean = false;

    if (res.status < 400) {
        const html = await res.text();
        const $ = cheerio.load(html);
        $("ol > li > div > .datetime").each((i, e) => {
            const date = e.children[0].data;
            const a = Date.parse(lastbook.book_last_update)
            const b = Date.parse(date)

            // if less than 0 the last book has been updated _before_ the current element,
            // so the book belonging to e needs to be updated 
            //
            // but because js dates are fucking stupid, see
            // console.log(
            //   new Date(Date.parse("2025-08-06")).toISOString(), 
            //   new Date(Date.parse("06 Aug 2025")).toISOString(), 
            // )
            // we need an offset of two hours plus epsilon to be sure 
            const delta = a - b
            if (delta < 7200001) {
                const heading = $(e.parent).find("h4")
                const lonk = $(heading).find('a').attr("href")
                //console.log(date, delta, heading.text().split('\n')[0], lonk)

                //console.log("Updating book:", heading.text())
                dirtyBooks.push(lonk)

            } else {
                pageClean = true
            }
        });

        if (dirtyBooks.length > 0) {
            console.log("Dirty books:", dirtyBooks.join(", "));
            await Promise.all(dirtyBooks.map((link, i) => updateBookTask(link)));
            SearchInstance.saveIndex() 

        } else {
            console.log("No updated books since last run!")
            return
        }

        if (pageClean) {
            // this page contained the last book that needed to be updated
            console.log("All books updated!")
            return
        } else {
            // there are more books on the next page that need updating
            await fetchBooks(pageNr + 1, lastbook)
            return
        }

    }
    else {
        console.error(res.status, res.statusText)
    }
}

