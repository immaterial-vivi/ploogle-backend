import e from "express";
import SearchInstance from "./SearchIndex.js";
import { schedCrawl, healIndex } from "./crawler.js";

import dotenv from 'dotenv'

dotenv.config({ path: '.env', quiet: true })

const app = e();
const PORT = process.env.PORT || 9191;

app.use(e.json());
app.use('/static', e.static('public'))

app.set('view engine', 'ejs');

if (process.env.PLOOGLE_CRAWLER_MODE) {
    schedCrawl()
}

if (process.env.PLOOGLE_INDEX_KNOWN_DIRTY) {
    healIndex()
}

/**
 * 
 * @param {*} req 
 * @returns 
 */
const getQueryParams = (req) => {
    const query = req.query['q'] ?? null;
    const page = Number(req.query['p'] ?? 1);
    const operator = req.query['op'] ?? "OR";
    const domain = req.query['d'] ?? null;
    const fuzzy = req.query['f'] ?? true;
    return {
        query, params: {
            page,
            operator,
            domain,
            fuzzy
        }
    }
}

if (process.env.PLOOGLE_API_MODE) {

    app.use(async (req, res, next) => {
        if (!req.headers["authorization"] || API_KEY != req.headers["authorization"]) {
            console.log(`403: unauthorized access /${req.baseUrl}, api key ${req.headers["authorization"]}, user-agent: ${req.headers["user-agent"]} `)
            res.status(403);
            res.end();
            return;
        }
        next()
    })

    const API_KEY = process.env.PLOOGLE_API_KEY
    app.get('/', (req, res) => {
        const { query, params } = getQueryParams(req);

        if (query == null) {
            res.status(400)
            console.log("400: no query", )
            res.json({ error: "query missing, see /help for info" });
        } else {
            const { data, info, error } = SearchInstance.search(query, params);
            if (error != null) {
                console.error("500: ", query, params, error)
                res.status(500);
                res.json(error);
            } else {
                console.log(`200: GET ${query}, page ${info.page.page}. ${info.count} results, took ${info.perf}`)
                res.json({ data, info });
            }
        }
    });

    const robots = `User-agent: *
                    Disallow: /`

    app.get('/robots.txt', (req, res) => {
        res.contentType('text/plain');
        res.status(200);
        res.write(robots);
        res.end();
    });
} else {
    app.get('/', (req, res) => {
        const { query, params } = getQueryParams(req);
        console.log(`Responding to ${query}`);

        if (query == null) {

            if (req.accepts("html")) {
                res.render('index');

            } else {
                res.status(400)
                res.json({ error: "query missing" });
            }
        } else {
            const { data, info, error } = SearchInstance.search(query, params);
            if (error != null) {
                res.status(500);
                res.json(error);
            } else {
                if (req.accepts("html")) {
                    res.render('serp', { results: data, renderDebug: false, queryTime: info.perf, query, params, info});
                } else {
                    res.json({ data, info });
                }
            }
            return;
        }
    });

}

app.get('/luck', (req,res) => {
    const query = req.query['q'] ?? null;
    const url = SearchInstance.random(query);
    console.log(`200: GET /luck, query ${query}, sending ${url}`)
 
    res.json({url})
})


await SearchInstance.initSearch();


app.listen(PORT, (err) => {
    if (err) console.log(err);
    console.log(`Ploogle listening on port ${PORT}`)
});

export { app as app }; 