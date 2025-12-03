#!/bin/bash

set -uo pipefail 
IFS=$'\n\t'

CMD="fanficfare"
OUT="$HOME/hdg-books/ao3"

mkdir -p "${OUT}"
cd "${OUT}"

for page in $(seq 1 2) # get first two pages
do
    echo "Downloading page ${page}..." 
    until "${CMD}" -p --non-interactive --force --download-list "https://archiveofourown.org/tags/Human%20Domestication%20Guide%20-%20GlitchyRobo/works?page=${page}"
    do
        echo "Page ${page} failed, retrying..."
    done
done 

