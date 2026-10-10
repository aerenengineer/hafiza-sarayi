#!/usr/bin/env python3
"""Wraps the page body (hafiza-sarayi.html) into a standalone index.html for GitHub Pages."""
import re, pathlib

here = pathlib.Path(__file__).parent
src = (here / "hafiza-sarayi.html").read_text(encoding="utf8")

title = re.search(r"<title>.*?</title>\n?", src, re.S).group(0)
link = re.search(r"<link [^>]*>\n?", src).group(0)
style = re.search(r"<style>.*?</style>\n?", src, re.S).group(0)
body = src.replace(title, "", 1).replace(link, "", 1).replace(style, "", 1)

reset = (
    "<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}"
    "body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>"
)
html = (
    '<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
    '<meta name="theme-color" content="#06070d">\n'
    + title + reset + "\n" + link + style + "</head>\n<body>\n" + body.strip() + "\n</body>\n</html>\n"
)
(here / "index.html").write_text(html, encoding="utf8")
print("index.html", len(html), "bytes")
