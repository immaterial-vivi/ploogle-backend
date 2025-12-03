# Ploogle 

## A thing to search hdg stories

(This should really be a mono repo) 

Most of the hard parts are done by a library called [MiniSearch](<https://github.com/lucaong/minisearch>) which is a little in memory search thing based on [BM25](<https://en.wikipedia.org/wiki/Okapi_BM25>), which i gladly took because reimplementing that stuff would have been more than a few evenings worth of botching things together. Well, mostly the acceleration data structure it uses as its index, some sort of radix tree, because those are a lot. 

The other question was how to get the actual texts into that search index. For that I used an external python script, [FanFicFare](<https://github.com/JimmXinu/FanFicFare>).

I combined the metadata scraping with fanficfare to get something that automatically downloads all ebooks that have been changed since the last changed in the existing dataset. Since Ao3s timestamps are  only day-accurate, it potentially overfetches a little bit, but what can i do? Also, because *nodejs has non blocking io* :upside_down: it can be queried during most of the fetching stuff, it only hitches if you hit it while it's rebuilding the search tree. So yeah, it has an up-to-date directory of all hdg stories in epub format :> 
(oh, yeah, i haven't said that, but yes, it's written in js because i'm trash :Laugh:)

Once it has an ebook, it adds it to the search index. As you might be aware, ebooks are just zipped websites with a few extra files (xhtml instead of html tho, and a manifest of what goes where and metadata). There's [another library](<https://github.com/gaoxiaoliangz/epub-parser>) that loads those zip files and their metadata back into memory, which then lets me extract all the actually interesting data.  Since the data i want is in html format, I have to do another step to actually extract the metadata and actual text. I use [an html parser](<https://cheerio.js.org/>) so i don't accidentally summon Zalgo into our plane of existance. That conveniently also lets me convert a chapter's text into markdown, which then goes into the search index. special characters and punctuation get stripped by minisearch, so at that point I'm done.
 
Since that operates on chapters, and I thought it might be more convenient if the search result linked to the actual chapter where the thing searched happens, So I don't index like 2000 stories but 12000 chapters, and then do some post-search cleaning up to group the results by story so you don't get 40 hits from dog of war alone. That all could be done better, and there are more options I could add to the query, but for now i'm ok with how it works and i want to get back to writing plant smut myself.    

The rest is just glue logic, a cron job, and a bit of express. 

"But Vivi," I hear you ask, "that all sounds terrible memory hungry and like it takes way too long to start up to use a lambda. How do you host that on netlify?" 
And the answer is: I don't. Actually that all lives on a private web server of mine, I just split it into a backend api, the thing I just described, and a frontend, the thing you actually see. That is just a few lines of sveltekit, because i'm comfortable writing that. There's a lot of uncleanliness on the css side of things because it didn't start out like that and at one point i copy pasted things over... but i am too lazy to fix it.  

uh, yeah, i think that's the gist of it